#include "ReelEngine.h"
#include <libtorrent/session.hpp>
#include <libtorrent/magnet_uri.hpp>
#include <libtorrent/torrent_info.hpp>
#include <libtorrent/torrent_status.hpp>
#include <libtorrent/alert_types.hpp>
#include <libtorrent/read_resume_data.hpp>
#include <libtorrent/write_resume_data.hpp>
#include <libtorrent/create_torrent.hpp>
#include <libtorrent/bencode.hpp>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <map>
#include <set>
#include <thread>
#include <regex>
#include <algorithm>
#ifdef _WIN32
#define NOMINMAX
#include <windows.h>
#endif

namespace lt = libtorrent;
namespace fs = std::filesystem;

static std::string quoted(std::string const& text) {
    std::ostringstream out;
    out << '"';
    for (unsigned char c : text) {
        if (c == '"' || c == '\\') out << '\\' << c;
        else if (c < 32) { const char* hex = "0123456789abcdef"; out << "\\u00" << hex[c >> 4] << hex[c & 15]; }
        else out << c;
    }
    out << '"';
    return out.str();
}

struct Engine {
    lt::session session;
    fs::path state;
    std::map<std::string, lt::torrent_handle> handles;
    std::set<std::string> selected;
    std::map<std::string,std::pair<int,int>> selections;
    std::string error;
    std::string snapshot;
    explicit Engine(const char* path, bool local) : session(settings(local)), state(fs::u8path(path)) { fs::create_directories(state); }
    static lt::settings_pack settings(bool local) {
        lt::settings_pack p;
        p.set_str(lt::settings_pack::user_agent, "Reel/0.1 libtorrent/2.0.11");
        p.set_int(lt::settings_pack::alert_mask, lt::alert_category::storage | lt::alert_category::error | lt::alert_category::status);
        p.set_int(lt::settings_pack::active_downloads, 3);
        p.set_int(lt::settings_pack::active_seeds, 0);
        p.set_int(lt::settings_pack::active_limit, 3);
        if (local) {
            p.set_bool(lt::settings_pack::enable_dht, false);
            p.set_bool(lt::settings_pack::enable_lsd, false);
            p.set_bool(lt::settings_pack::enable_upnp, false);
            p.set_bool(lt::settings_pack::enable_natpmp, false);
            p.set_str(lt::settings_pack::listen_interfaces, "127.0.0.1:0");
        }
        return p;
    }
    void alerts() {
        std::vector<lt::alert*> list;
        session.pop_alerts(&list);
        for (auto* a : list) {
            if (auto* r = lt::alert_cast<lt::save_resume_data_alert>(a)) {
                for (auto const& [id, handle] : handles) {
                    if (handle == r->handle) {
                        auto bytes = lt::write_resume_data_buf(r->params);
                        auto path = state / (id + ".resume");
                        auto temp = path;
                        temp += ".tmp";
                        std::ofstream out(temp, std::ios::binary);
                        out.write(bytes.data(), bytes.size());
                        out.close();
                        if (out) {
#ifdef _WIN32
                            if (!MoveFileExW(temp.c_str(), path.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) throw std::runtime_error("Could not save torrent resume state");
#else
                            fs::rename(temp, path);
#endif
                        }
                    }
                }
            }
        }
    }
    static std::pair<int,int> episode(std::string const& path) {
        std::smatch match;
        if (std::regex_search(path,match,std::regex(R"(s([0-9]{1,3})[ ._-]*e([0-9]{1,4}))",std::regex::icase)) || std::regex_search(path,match,std::regex(R"(\b([0-9]{1,3})x([0-9]{1,4})\b)",std::regex::icase))) return {std::stoi(match[1]),std::stoi(match[2])};
        std::smatch folder,number;
        auto filename=fs::path(path).filename().string();
        if (std::regex_search(path,folder,std::regex(R"((?:season[ ._-]*|\bs)([0-9]{1,3})[\/ ._-])",std::regex::icase)) && std::regex_search(filename,number,std::regex(R"(^(?:episode[ ._-]*)?([0-9]{1,3})[ ._-])",std::regex::icase))) return {std::stoi(folder[1]),std::stoi(number[1])};
        return {-1,-1};
    }
    std::vector<lt::file_index_t> videos(lt::torrent_handle const& h,std::string const& id) {
        auto info=h.torrent_file();
        if (!info) return {};
        auto const& files=info->files();
        auto selection=selections.at(id);
        std::vector<lt::file_index_t> output;
        lt::file_index_t best{-1};std::int64_t size=0;
        for (auto i:files.file_range()) {
            auto name=files.file_path(i),ext=fs::path(name).extension().string();
            std::transform(ext.begin(),ext.end(),ext.begin(),::tolower);
            if (ext!=".mp4" && ext!=".mkv" && ext!=".avi" && ext!=".mov" && ext!=".m4v" && ext!=".webm") continue;
            if (selection.first<0) {if(files.file_size(i)>size){best=i;size=files.file_size(i);}continue;}
            if (std::regex_search(name,std::regex(R"((?:^|[\/ ._-])(?:sample|trailer|extras)(?:[\/ ._-]|$))",std::regex::icase))) continue;
            auto identity=episode(name);
            if (identity.first==selection.first && (selection.second<0 || identity.second==selection.second)) output.push_back(i);
        }
        if (selection.first<0 && best!=lt::file_index_t{-1}) output.push_back(best);
        if (selected.insert(id).second) {
            std::vector<lt::download_priority_t> priorities(files.num_files(),lt::dont_download);
            for(auto i:output)priorities[static_cast<int>(i)]=lt::default_priority;
            h.prioritize_files(priorities);
            if(selection.first>=0 && !output.empty())h.unset_flags(lt::torrent_flags::upload_mode);
        }
        return output;
    }
};

ReelEngine reel_create(const char* path, int local) { try { return new Engine(path, local != 0); } catch (...) { return nullptr; } }
const char* reel_error(ReelEngine e) { return e ? static_cast<Engine*>(e)->error.c_str() : "Could not start the torrent engine"; }

int reel_add(ReelEngine raw, const char* id, const char* uri, const char* save, int restore, int season, int episode) {
    auto* e = static_cast<Engine*>(raw);
    if (!e) return 0;
    try {
        e->error.clear();
        if (e->handles.count(id)) return 1;
        lt::add_torrent_params params;
        bool loaded = false;
        if (restore) {
            std::ifstream in(e->state / (std::string(id) + ".resume"), std::ios::binary);
            std::vector<char> data((std::istreambuf_iterator<char>(in)), {});
            if (!data.empty()) { lt::error_code ec; params = lt::read_resume_data(data, ec); loaded = !ec; }
        }
        if (!loaded) {
            std::string source(uri);
            if (source.rfind("magnet:", 0) == 0) params = lt::parse_magnet_uri(source);
            else params.ti = std::make_shared<lt::torrent_info>(source);
            params.flags &= ~lt::torrent_flags::paused;
            params.flags &= ~lt::torrent_flags::auto_managed;
        }
        params.flags |= lt::torrent_flags::duplicate_is_error;
        params.save_path = save;
        if(season>=0){params.file_priorities.assign(params.ti?params.ti->num_files():0,lt::dont_download);params.flags|=lt::torrent_flags::upload_mode;}
        auto handle = e->session.add_torrent(params);
        e->handles.emplace(id, handle);
        e->selections[id]={season,episode};
        e->videos(handle, id);
        return 1;
    } catch (std::exception const& ex) { e->error = ex.what(); return 0; }
}

int reel_pause(ReelEngine raw, const char* id, int paused) {
    auto* e = static_cast<Engine*>(raw);
    if (!e) return 0;
    try { auto h = e->handles.at(id); if (paused) h.pause(); else h.resume(); h.save_resume_data(lt::torrent_handle::save_info_dict); return 1; }
    catch (std::exception const& ex) { e->error = ex.what(); return 0; }
}

int reel_remove(ReelEngine raw, const char* id) {
    auto* e = static_cast<Engine*>(raw);
    if (!e) return 0;
    try {
        e->session.remove_torrent(e->handles.at(id));
        e->handles.erase(id); e->selected.erase(id); e->selections.erase(id);
        fs::remove(e->state / (std::string(id) + ".resume"));
        return 1;
    } catch (std::exception const& ex) { e->error = ex.what(); return 0; }
}

const char* reel_snapshot(ReelEngine raw) {
    auto* e = static_cast<Engine*>(raw);
    if (!e) return "[]";
    try {
        e->alerts();
        std::ostringstream out;
        out << '[';
        bool first = true;
        for (auto const& [id, handle] : e->handles) {
            auto chosen=e->videos(handle,id);
            auto info=handle.torrent_file();
            auto progress=handle.file_progress();
            std::string path=chosen.empty()?"":info->files().file_path(chosen.front());
            std::int64_t wanted=0,done=0;
            bool finished=!chosen.empty();
            for(auto index:chosen){auto size=info->files().file_size(index),downloaded=progress.at(static_cast<int>(index));wanted+=size;done+=downloaded;if(downloaded<size)finished=false;}
            bool tv=e->selections.at(id).first>=0;
            std::string selectionError=tv&&info&&chosen.empty()?"No matching episodes found in this torrent.":"";
            auto s = handle.status();
            if (!first) out << ',';
            first = false;
            out << "{\"id\":" << quoted(id) << ",\"name\":" << quoted(s.name)
                << ",\"progress\":" << (tv?(wanted?double(done)/wanted:0):s.progress) << ",\"downloadRate\":" << s.download_payload_rate
                << ",\"uploaded\":" << s.total_payload_upload << ",\"downloaded\":" << (tv?done:s.total_wanted_done)
                << ",\"total\":" << (tv?wanted:s.total_wanted) << ",\"peers\":" << s.num_peers
                << ",\"paused\":" << ((s.flags & lt::torrent_flags::paused) ? "true" : "false")
                << ",\"finished\":" << ((tv?finished:s.is_finished) ? "true" : "false")
                << ",\"metadata\":" << (s.has_metadata ? "true" : "false")
                << ",\"state\":" << static_cast<int>(s.state) << ",\"error\":" << quoted(s.errc ? s.errc.message() : selectionError)
                << ",\"videoPath\":" << quoted(path) << ",\"videos\":[";
            bool firstVideo=true;
            for(auto index:chosen){
                if(!firstVideo)out<<',';firstVideo=false;
                auto name=info->files().file_path(index);auto identity=Engine::episode(name);
                auto size=info->files().file_size(index),downloaded=progress.at(static_cast<int>(index));
                out<<"{\"index\":"<<static_cast<int>(index)<<",\"path\":"<<quoted(name)<<",\"size\":"<<size<<",\"downloaded\":"<<downloaded<<",\"completed\":"<<(downloaded>=size?"true":"false");
                if(identity.first>=0)out<<",\"season\":"<<identity.first<<",\"episode\":"<<identity.second;
                out<<'}';
            }
            out<<"]}";
        }
        out << ']'; e->snapshot = out.str();
    } catch (std::exception const& ex) { e->error = ex.what(); e->snapshot = "[]"; }
    return e->snapshot.c_str();
}

void reel_save(ReelEngine raw) {
    auto* e = static_cast<Engine*>(raw);
    if (!e) return;
    try { for (auto const& [id, h] : e->handles) h.save_resume_data(lt::torrent_handle::save_info_dict); e->alerts(); } catch (...) {}
}

void reel_destroy(ReelEngine raw) {
    auto* e = static_cast<Engine*>(raw);
    if (!e) return;
    reel_save(raw);
    for (int i = 0; i < 20; ++i) { std::this_thread::sleep_for(std::chrono::milliseconds(50)); try { e->alerts(); } catch (...) {} }
    delete e;
}

int reel_make_test_torrent(const char* path, const char* output) {
    try {
        lt::file_storage files;
        lt::add_files(files, path);
        lt::create_torrent torrent(files, 16384);
        lt::set_piece_hashes(torrent, fs::path(path).parent_path().string());
        auto bytes = torrent.generate_buf();
        std::ofstream out(fs::u8path(output), std::ios::binary);
        out.write(bytes.data(), bytes.size());
        return out ? 1 : 0;
    } catch (...) { return 0; }
}

int reel_listen_port(ReelEngine raw) {
    auto* e = static_cast<Engine*>(raw);
    return e ? e->session.listen_port() : 0;
}

int reel_connect_peer(ReelEngine raw, const char* id, int port) {
    auto* e = static_cast<Engine*>(raw);
    if (!e) return 0;
    try { e->handles.at(id).connect_peer(lt::tcp::endpoint(lt::make_address("127.0.0.1"), static_cast<unsigned short>(port))); return 1; }
    catch (std::exception const& ex) { e->error = ex.what(); return 0; }
}

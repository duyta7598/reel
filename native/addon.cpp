#include <napi.h>
#include "ReelEngine.h"
struct Holder { ReelEngine handle; };
static Holder* holder(Napi::CallbackInfo const& info) {
    auto* value = info[0].As<Napi::External<Holder>>().Data();
    if (!value->handle) throw Napi::Error::New(info.Env(), "Torrent engine is closed");
    return value;
}
static std::string text(Napi::CallbackInfo const& info, int index) { return info[index].As<Napi::String>().Utf8Value(); }
static Napi::Object init(Napi::Env env, Napi::Object exports) {
    exports.Set("create", Napi::Function::New(env, [](Napi::CallbackInfo const& info) -> Napi::Value {
        auto h = reel_create(text(info, 0).c_str(), info[1].As<Napi::Boolean>().Value());
        if (!h) throw Napi::Error::New(info.Env(), "Could not start libtorrent");
        return Napi::External<Holder>::New(info.Env(), new Holder{h}, [](Napi::Env, Holder* item) { if (item->handle) reel_destroy(item->handle); delete item; });
    }));
    exports.Set("add", Napi::Function::New(env, [](Napi::CallbackInfo const& info) { auto h=holder(info)->handle; if (!reel_add(h,text(info,1).c_str(),text(info,2).c_str(),text(info,3).c_str(),info[4].As<Napi::Boolean>().Value(),info.Length()>5?info[5].As<Napi::Number>().Int32Value():-1,info.Length()>6?info[6].As<Napi::Number>().Int32Value():-1)) throw Napi::Error::New(info.Env(),reel_error(h)); }));
    exports.Set("pause", Napi::Function::New(env, [](Napi::CallbackInfo const& info) { auto h=holder(info)->handle; if (!reel_pause(h,text(info,1).c_str(),info[2].As<Napi::Boolean>().Value())) throw Napi::Error::New(info.Env(),reel_error(h)); }));
    exports.Set("remove", Napi::Function::New(env, [](Napi::CallbackInfo const& info) { auto h=holder(info)->handle; if (!reel_remove(h,text(info,1).c_str())) throw Napi::Error::New(info.Env(),reel_error(h)); }));
    exports.Set("snapshot", Napi::Function::New(env, [](Napi::CallbackInfo const& info) { return Napi::String::New(info.Env(),reel_snapshot(holder(info)->handle)); }));
    exports.Set("save", Napi::Function::New(env, [](Napi::CallbackInfo const& info) { reel_save(holder(info)->handle); }));
    exports.Set("destroy", Napi::Function::New(env, [](Napi::CallbackInfo const& info) { auto* item=holder(info); reel_destroy(item->handle); item->handle=nullptr; }));
    exports.Set("makeTestTorrent", Napi::Function::New(env, [](Napi::CallbackInfo const& info) { return Napi::Boolean::New(info.Env(),reel_make_test_torrent(text(info,0).c_str(),text(info,1).c_str())); }));
    exports.Set("listenPort", Napi::Function::New(env, [](Napi::CallbackInfo const& info) { return Napi::Number::New(info.Env(),reel_listen_port(holder(info)->handle)); }));
    exports.Set("connectPeer", Napi::Function::New(env, [](Napi::CallbackInfo const& info) { auto h=holder(info)->handle; if (!reel_connect_peer(h,text(info,1).c_str(),info[2].As<Napi::Number>().Int32Value())) throw Napi::Error::New(info.Env(),reel_error(h)); }));
    return exports;
}
NODE_API_MODULE(reel_engine, init)

#pragma once
#ifdef __cplusplus
extern "C" {
#endif
typedef void* ReelEngine;
ReelEngine reel_create(const char* state_path, int local_only);
void reel_destroy(ReelEngine engine);
int reel_add(ReelEngine engine, const char* id, const char* uri, const char* save_path, int restore, int season, int episode);
int reel_pause(ReelEngine engine, const char* id, int paused);
int reel_remove(ReelEngine engine, const char* id);
const char* reel_snapshot(ReelEngine engine);
const char* reel_error(ReelEngine engine);
void reel_save(ReelEngine engine);
int reel_make_test_torrent(const char* path, const char* output);
int reel_listen_port(ReelEngine engine);
int reel_connect_peer(ReelEngine engine, const char* id, int port);
#ifdef __cplusplus
}
#endif

import argparse
import json
import logging
import multiprocessing
import os
import signal
import subprocess
from pathlib import Path

os.environ["TQDM_DISABLE"] = "1"

import numpy as np
import srt
from ffsubsync.ffsubsync import make_parser, validate_and_transform_args, make_reference_pipe, try_sync

logging.disable(logging.CRITICAL)
children = []
original_popen = subprocess.Popen

class ChildProcess(original_popen):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        children.append(self)

subprocess.Popen = ChildProcess

def stop(*_):
    for child in children:
        if child.poll() is None:
            child.terminate()
    raise SystemExit(130)

signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)

def quality(reference, output):
    cues = list(srt.parse(Path(output).read_text(encoding="utf-8-sig")))
    if len(cues) < 10:
        return False, 0.0
    audio = np.asarray(reference) > 0.5
    subtitles = np.zeros(len(audio), dtype=bool)
    outside = 0
    hits = 0
    for cue in cues:
        start = int(cue.start.total_seconds() * 100)
        end = int(cue.end.total_seconds() * 100)
        if start < -100 or end > len(audio) + 100 or end <= start:
            outside += 1
        start, end = max(0, start), min(len(audio), end)
        if end > start:
            subtitles[start:end] = True
            hits += bool(np.any(audio[start:end]))
    def correlation(a, b):
        if a.std() == 0 or b.std() == 0:
            return 0.0
        return float(np.corrcoef(a, b)[0, 1])
    score = correlation(audio, subtitles)
    segments = []
    for a, b in zip(np.array_split(audio, 3), np.array_split(subtitles, 3)):
        if a.sum() >= 500 and b.sum() >= 500:
            segments.append(correlation(a, b))
    accepted = score >= 0.12 and hits / len(cues) >= 0.6 and outside / len(cues) <= 0.02 and all(x >= 0.05 for x in segments)
    return accepted, score

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", required=True)
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--status", required=True)
    parser.add_argument("--ffmpeg", required=True)
    options = parser.parse_args()
    result = {"accepted": False, "score": 0.0, "offset": 0.0, "scale": 1.0}
    try:
        args = make_parser().parse_args([options.video, "-i", options.input, "-o", options.output, "--ffmpeg-path", options.ffmpeg, "--vad", "webrtc", "--skip-sync-on-low-quality", "--quality-max-offset-seconds", "60", "--max-framerate-deviation", "0.05", "--output-encoding", "utf-8", "--skip-infer-framerate-ratio"])
        args = validate_and_transform_args(args)
        reference = make_reference_pipe(args)
        reference.fit(options.video)
        sync_result = {}
        successful = try_sync(args, reference, sync_result)
        if successful and Path(options.output).exists():
            accepted, score = quality(reference.transform(options.video), options.output)
            result.update(accepted=accepted, score=score, offset=float(sync_result["offset_seconds"]), scale=float(sync_result["framerate_scale_factor"]))
    except Exception:
        result["accepted"] = False
    finally:
        Path(options.status).write_text(json.dumps(result), encoding="utf-8")
        for child in children:
            if child.poll() is None:
                child.terminate()

if __name__ == "__main__":
    multiprocessing.freeze_support()
    main()

"""Turning a video (or photo post) into a small set of downscaled JPEG frames for Claude.

A frame is taken every FRAME_EVERY seconds (default 1.5), shrunk so its long side is FRAME_SIZE px (default 512, about
200 tokens each), and skipped if it looks almost the same as the last frame kept. Long videos are sampled more thinly so
there are never more than MAX_FRAMES frames.
"""
import os

import cv2
import numpy as np

import sources

FRAME_EVERY = float(os.environ.get('FRAME_EVERY', 1.5))
FRAME_SIZE = int(os.environ.get('FRAME_SIZE', 512))
MAX_FRAMES = int(os.environ.get('MAX_FRAMES', 80))
PHOTO_SIZE = 1024                         # photo posts are few and often full of text, so they get more pixels
MAX_PHOTOS = 20
SAME = 3.0                                # mean pixel difference (0-255) below which two frames count as the same


def shrink(img, side):
    h, w = img.shape[:2]
    k = side / max(h, w)
    return cv2.resize(img, (max(1, round(w * k)), max(1, round(h * k))), interpolation=cv2.INTER_AREA) if k < 1 else img


def jpeg(img):
    ok, buf = cv2.imencode('.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, 72])
    return buf.tobytes()


def thumb(img):
    return cv2.resize(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), (32, 32), interpolation=cv2.INTER_AREA).astype(np.int16)


def video_frames(path):
    """([(seconds, jpeg bytes)], video length in seconds, sampling interval in seconds)."""
    cap = cv2.VideoCapture(path)
    if not cap.isOpened(): raise RuntimeError('Could not open the video file')
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    duration = count / fps if count else 0
    every = max(FRAME_EVERY, duration / MAX_FRAMES) if duration else FRAME_EVERY
    out, last, i, nxt = [], None, 0, 0.0
    while True:
        if not cap.grab(): break                             # grab() only decodes the frames we keep
        t = i / fps
        i += 1
        if t + 1e-6 < nxt: continue
        nxt += every
        ok, img = cap.retrieve()
        if not ok: continue
        small = shrink(img, FRAME_SIZE)
        th = thumb(small)
        if last is not None and np.abs(th - last).mean() < SAME: continue
        last = th
        out.append((t, jpeg(small)))
        if len(out) >= MAX_FRAMES: break
    cap.release()
    return out, duration or (i / fps), every


def photos(urls):
    """[jpeg bytes] for photo posts and slideshows."""
    out = []
    for u in urls[:MAX_PHOTOS]:
        data, _ = sources.get(sources.with_token(u), limit=30_000_000)
        img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
        if img is not None: out.append(jpeg(shrink(img, PHOTO_SIZE)))
    return out

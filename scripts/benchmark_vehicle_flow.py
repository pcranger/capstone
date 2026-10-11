"""Replay the native worker's bounded LK selection on road clips; this is evidence coverage, not labeled accuracy.

Example: python3 scripts/benchmark_vehicle_flow.py --model /path/to/bdd.pt --output /tmp/flow.json clip.MOV
The detector remains at imgsz=640. Timings here are desktop timings; measure the installed app separately.
"""
import argparse
import json
import time
from pathlib import Path
import cv2
import numpy as np
from ultralytics import YOLO


def flow(previous, current, boxes):
    h, w = current.shape
    background = np.full((h, w), 255, np.uint8)
    selected, cells = [], set()

    def collect(mask, count):
        points = cv2.goodFeaturesToTrack(current, count, .01, 5, mask=mask, blockSize=3)
        for x, y in ([] if points is None else points[:, 0]):
            cell = (int(x / 5), int(y / 5))
            if 8 <= x < w - 8 and 8 <= y < h - 8 and cell not in cells:
                cells.add(cell)
                selected.append((x, y))

    for left, top, right, bottom in boxes[:12]:
        x0, x1 = int(left*w), int(right*w)
        y0, y1 = int(top*h), int(bottom*h)
        mask = np.zeros((h, w), np.uint8)
        mask[y0:y1, x0:x1] = 255
        collect(mask, 20)
        background[y0:y1, x0:x1] = 0
    collect(background, 160)
    if len(selected) < 6:
        return np.zeros((0, 4))
    xy = np.array(selected[:400], np.float32).reshape(-1, 1, 2)
    args = dict(winSize=(15, 15), maxLevel=2, criteria=(cv2.TERM_CRITERIA_COUNT | cv2.TERM_CRITERIA_EPS, 20, .01))
    q, valid, _ = cv2.calcOpticalFlowPyrLK(current, previous, xy, None, **args)
    back, reverse, _ = cv2.calcOpticalFlowPyrLK(previous, current, q, None, **args)
    keep = (valid[:, 0] > 0) & (reverse[:, 0] > 0) & (np.linalg.norm(xy[:, 0] - back[:, 0], axis=1) < 1)
    return np.column_stack((xy[keep, 0] / [w, h], xy[keep, 0] - q[keep, 0]))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--frames', type=int, default=30)
    parser.add_argument('--motion-size',type=int,default=384)
    parser.add_argument('videos', nargs='+')
    args = parser.parse_args()
    model = YOLO(args.model)
    cv2.setNumThreads(2)
    reports = []
    for filename in args.videos:
        cap = cv2.VideoCapture(filename)
        fps = cap.get(cv2.CAP_PROP_FPS) or 30
        stride = max(1, round(fps / 5))
        previous, timings = None, []
        report = dict(video=str(Path(filename).resolve()), frames=0, vehicle_pairs=0, supported_pairs=0,
                      moving_evidence_pairs=0, stationary_evidence_pairs=0, left_to_right=0, right_to_left=0)
        index = 0
        while report['frames'] < args.frames:
            ok, image = cap.read()
            if not ok:
                break
            index += 1
            if (index-1) % stride:
                continue
            result = model.predict(image, imgsz=640, conf=.08, verbose=False, device='cpu')[0]
            boxes = [box.xyxy[0].cpu().numpy() / [image.shape[1],image.shape[0],image.shape[1],image.shape[0]]
                     for box in result.boxes if result.names[int(box.cls[0])] in ('car','truck','bus','motorcycle','bicycle')]
            scale = args.motion_size / max(image.shape[:2])
            gray = cv2.resize(cv2.cvtColor(image, cv2.COLOR_BGR2GRAY),
                              (max(32, round(image.shape[1]*scale)),max(32, round(image.shape[0]*scale))))
            report['frames'] += 1
            if previous is not None:
                start = time.perf_counter()
                points = flow(previous, gray, boxes)
                timings.append((time.perf_counter()-start)*1000)
                for left, top, right, bottom in boxes:
                    report['vehicle_pairs'] += 1
                    local = points[(points[:,0]>left)&(points[:,0]<right)&(points[:,1]>top)&(points[:,1]<bottom)]
                    outside = np.ones(len(points), bool)
                    for b in boxes:
                        outside &= ~((points[:,0]>b[0]-.01)&(points[:,0]<b[2]+.01)&(points[:,1]>b[1]-.01)&(points[:,1]<b[3]+.01))
                    bg = points[outside]
                    if len(local)<3 or len(bg)<10:
                        continue
                    cx, cy = (left+right)/2, (top+bottom)/2
                    distance = ((bg[:,0]-cx)*gray.shape[1]/max(30,(right-left)*gray.shape[1]))**2 + ((bg[:,1]-cy)*gray.shape[0]/max(20,(bottom-top)*gray.shape[0]*.65))**2
                    nearby = bg[np.argsort(distance)[:40],2:]
                    camera = np.median(nearby,axis=0)
                    noise = np.median(np.linalg.norm(nearby-camera,axis=1))
                    if noise >= 1.5:
                        continue
                    report['supported_pairs'] += 1
                    residual = np.median(local[:,2:],axis=0)-camera
                    diagonal = max(12,np.hypot((right-left)*gray.shape[1],(bottom-top)*gray.shape[0]))
                    moving = np.linalg.norm(residual)>max(.3,noise*2) and np.linalg.norm(residual)/(stride/fps)/diagonal>.10
                    report['moving_evidence_pairs' if moving else 'stationary_evidence_pairs'] += 1
                    if moving and abs(residual[0])>.3:
                        report['left_to_right' if residual[0]>0 else 'right_to_left'] += 1
            previous = gray
        cap.release()
        report['desktop_flow_median_ms'] = round(float(np.median(timings)),2) if timings else None
        reports.append(report)
    Path(args.output).write_text(json.dumps({'note':'No manual ground truth; per-frame evidence coverage, not alert accuracy. Desktop worker timing excludes model and bridge.', 'clips':reports},indent=2))
    print(json.dumps(reports,indent=2))


if __name__ == '__main__':
    main()

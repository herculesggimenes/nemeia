#!/usr/bin/env python3
"""YOLOE + SAM2 + optional Gemma4 review pipeline.

This script is intentionally file-based: it writes JSON, overlays, and masks that
can be consumed by a later camera/LiDAR projection step.
"""

import argparse
import base64
import json
import time
import urllib.request
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from ultralytics import SAM, YOLOE


DEFAULT_CLASSES = [
    "person",
    "human hand",
    "face",
    "cup",
    "mug",
    "bottle",
    "bowl",
    "plate",
    "spoon",
    "fork",
    "knife",
    "chair",
    "table",
    "countertop",
    "sink",
    "faucet",
    "door",
    "handle",
    "wheel",
    "bag",
    "phone",
    "laptop",
    "keyboard",
    "cable",
    "sponge",
    "dish soap bottle",
    "kettle",
]


DEFAULT_IMAGE_URLS = {
    "bus": "https://ultralytics.com/images/bus.jpg",
    "zidane": "https://ultralytics.com/images/zidane.jpg",
}


GEMMA_REVIEW_PROMPT = """You are reviewing object segmentation for a robot.
Return compact JSON only with this schema:
{
  "accept": ["label names that look correct"],
  "rename": [{"from": "detected label", "to": "better label", "reason": "short"}],
  "missing": [{"label": "object or object part", "segment_prompt": "short prompt for SAM", "reason": "short"}],
  "hazards": ["short hazard labels"],
  "notes": ["short notes"]
}
Focus on robot-relevant objects and parts: hands, people, sharp objects, cables,
wet surfaces, handles, rims, faucet, sink basin, transparent objects, and small
partially occluded items.
"""


def read_classes(path: Path | None) -> list[str]:
    if path is None:
        return DEFAULT_CLASSES
    return [line.strip() for line in path.read_text(encoding="utf-8").splitlines() if line.strip() and not line.startswith("#")]


def download(url: str, dest: Path) -> None:
    if dest.exists() and dest.stat().st_size > 0:
        return
    with urllib.request.urlopen(url, timeout=30) as response:
        dest.write_bytes(response.read())


def collect_images(image_dir: Path, include_defaults: bool) -> list[Path]:
    image_dir.mkdir(parents=True, exist_ok=True)
    if include_defaults:
        for name, url in DEFAULT_IMAGE_URLS.items():
            download(url, image_dir / f"{name}.jpg")
    exts = {".jpg", ".jpeg", ".png", ".webp"}
    return sorted(p for p in image_dir.iterdir() if p.suffix.lower() in exts)


def resize_inputs(image_paths: list[Path], input_dir: Path, max_side: int) -> list[Path]:
    input_dir.mkdir(parents=True, exist_ok=True)
    resized = []
    for image_path in image_paths:
        out_path = input_dir / f"{image_path.stem}.jpg"
        image = cv2.imread(str(image_path))
        if image is None:
            print(f"warning: could not read {image_path}")
            continue
        h, w = image.shape[:2]
        scale = min(1.0, max_side / max(h, w))
        if scale < 1.0:
            image = cv2.resize(image, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
        cv2.imwrite(str(out_path), image)
        resized.append(out_path)
    return resized


def detections_from_result(result: Any, prefix: str) -> list[dict[str, Any]]:
    boxes = result.boxes
    if boxes is None:
        return []
    names = result.names
    xyxy = boxes.xyxy.cpu().numpy()
    cls = boxes.cls.cpu().numpy().astype(int)
    conf = boxes.conf.cpu().numpy()
    detections = []
    for i, box in enumerate(xyxy):
        label = names.get(int(cls[i]), str(int(cls[i])))
        detections.append(
            {
                "id": f"{prefix}_{i:03d}",
                "label": label,
                "confidence": float(conf[i]),
                "box_xyxy": [float(x) for x in box],
            }
        )
    return detections


def mask_count(result: Any) -> int:
    return 0 if result.masks is None else len(result.masks)


def draw_boxes(image_path: Path, detections: list[dict[str, Any]], out_path: Path) -> None:
    image = cv2.imread(str(image_path))
    if image is None:
        raise RuntimeError(f"Could not read {image_path}")
    for det in detections:
        x1, y1, x2, y2 = [int(round(x)) for x in det["box_xyxy"]]
        label = f'{det["label"]} {det["confidence"]:.2f}'
        cv2.rectangle(image, (x1, y1), (x2, y2), (30, 220, 60), 2)
        cv2.putText(image, label, (x1, max(20, y1 - 6)), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (30, 220, 60), 2)
    cv2.imwrite(str(out_path), image)


def save_masks_and_overlay(
    image_path: Path,
    sam_result: Any,
    detections: list[dict[str, Any]],
    mask_dir: Path,
    overlay_path: Path,
) -> list[dict[str, Any]]:
    image = cv2.imread(str(image_path))
    if image is None:
        raise RuntimeError(f"Could not read {image_path}")

    mask_dir.mkdir(parents=True, exist_ok=True)
    overlay = image.copy()
    rng = np.random.default_rng(42)
    masks = [] if sam_result.masks is None else sam_result.masks.data.cpu().numpy()
    instances = []

    for i, mask in enumerate(masks):
        det = detections[i] if i < len(detections) else {"id": f"unknown_{i:03d}", "label": "unknown", "confidence": 0, "box_xyxy": []}
        binary = mask > 0.5
        mask_path = mask_dir / f'{det["id"]}_{det["label"].replace(" ", "_")}.png'
        cv2.imwrite(str(mask_path), (binary.astype(np.uint8) * 255))

        color = rng.integers(40, 240, size=3, dtype=np.uint8)
        overlay[binary] = (0.55 * overlay[binary] + 0.45 * color).astype(np.uint8)
        if det["box_xyxy"]:
            x1, y1, _, _ = [int(round(x)) for x in det["box_xyxy"]]
            cv2.putText(overlay, det["label"], (x1, max(20, y1 - 6)), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 2)

        instances.append(
            {
                **det,
                "mask_path": str(mask_path),
                "mask_area_px": int(binary.sum()),
            }
        )

    cv2.imwrite(str(overlay_path), overlay)
    return instances


def run_predict(model: Any, image_path: Path, **kwargs: Any) -> tuple[Any, float]:
    start = time.perf_counter()
    results = model.predict(str(image_path), verbose=False, **kwargs)
    return results[0], time.perf_counter() - start


def run_sam_boxes(sam: SAM, image_path: Path, detections: list[dict[str, Any]], device: str) -> tuple[Any | None, float]:
    if not detections:
        return None, 0.0
    boxes = [det["box_xyxy"] for det in detections]
    start = time.perf_counter()
    results = sam(str(image_path), bboxes=boxes, device=device, verbose=False)
    return results[0], time.perf_counter() - start


def call_gemma4_review(
    ollama_host: str,
    model: str,
    image_path: Path,
    detections: list[dict[str, Any]],
    timeout: int,
) -> dict[str, Any]:
    review_input = {
        "detected": [
            {
                "id": det["id"],
                "label": det["label"],
                "confidence": round(det["confidence"], 3),
                "box_xyxy": [round(x, 1) for x in det["box_xyxy"]],
            }
            for det in detections
        ]
    }
    prompt = GEMMA_REVIEW_PROMPT + "\nDetected objects:\n" + json.dumps(review_input, separators=(",", ":"))
    payload = {
        "model": model,
        "prompt": prompt,
        "images": [base64.b64encode(image_path.read_bytes()).decode()],
        "stream": False,
        "format": "json",
        "options": {"temperature": 0, "num_predict": 800},
    }
    request = urllib.request.Request(
        f"{ollama_host.rstrip('/')}/api/generate",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    start = time.perf_counter()
    with urllib.request.urlopen(request, timeout=timeout) as response:
        raw = json.loads(response.read())
    elapsed = time.perf_counter() - start
    eval_count = raw.get("eval_count") or 0
    eval_seconds = (raw.get("eval_duration") or 0) / 1e9
    text = raw.get("response", "{}")
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        parsed = {"parse_error": True, "raw": text}
    return {
        "seconds": elapsed,
        "gen_tokens": eval_count,
        "gen_tok_s": eval_count / eval_seconds if eval_seconds else 0,
        "review": parsed,
    }


def add_label_count(bucket: dict[str, int], label: str, amount: int = 1) -> None:
    bucket[label] = bucket.get(label, 0) + amount


def flatten_text_items(items: Any) -> list[str]:
    if not isinstance(items, list):
        return []
    flattened = []
    for item in items:
        if isinstance(item, str):
            flattened.append(item)
        elif isinstance(item, list):
            flattened.extend(str(child) for child in item if child)
        elif item:
            flattened.append(str(item))
    return flattened


def build_global_status(summary: dict[str, Any], instances: list[dict[str, Any]]) -> dict[str, Any]:
    status: dict[str, Any] = {
        "image_count": len(summary["images"]),
        "labels": {
            "prompt_free": {},
            "text_prompted": {},
            "sam2_segmented": {},
            "gemma_missing": {},
            "gemma_renames": [],
            "hazards": {},
        },
        "objects": [],
        "segmentations": {
            "count": len(instances),
            "with_mask_path": sum(1 for item in instances if item.get("mask_path")),
            "total_mask_area_px": int(sum(item.get("mask_area_px", 0) for item in instances)),
        },
        "timings": {
            "prompt_free_seconds": 0.0,
            "text_prompted_seconds": 0.0,
            "sam2_seconds": 0.0,
            "gemma_seconds": 0.0,
        },
    }

    for image_name, image_summary in summary["images"].items():
        status["timings"]["prompt_free_seconds"] += image_summary["prompt_free"]["seconds"]
        status["timings"]["text_prompted_seconds"] += image_summary["text_prompted"]["seconds"]
        status["timings"]["sam2_seconds"] += image_summary["sam2_from_text_boxes"]["seconds"]

        for det in image_summary["prompt_free"]["detections"]:
            add_label_count(status["labels"]["prompt_free"], det["label"])
        for det in image_summary["text_prompted"]["detections"]:
            add_label_count(status["labels"]["text_prompted"], det["label"])

        gemma = image_summary.get("gemma_review")
        if gemma:
            status["timings"]["gemma_seconds"] += gemma.get("seconds", 0.0)
            review = gemma.get("review") or {}
            for missing in review.get("missing", []):
                if isinstance(missing, dict):
                    add_label_count(status["labels"]["gemma_missing"], missing.get("label", "unknown"))
            for hazard in flatten_text_items(review.get("hazards", [])):
                add_label_count(status["labels"]["hazards"], hazard)
            for rename in review.get("rename", []):
                if isinstance(rename, dict):
                    status["labels"]["gemma_renames"].append({"image": image_name, **rename})

    for item in instances:
        add_label_count(status["labels"]["sam2_segmented"], item["label"])
        status["objects"].append(
            {
                "id": item["id"],
                "label": item["label"],
                "confidence": item["confidence"],
                "image": item["image"],
                "box_xyxy": item["box_xyxy"],
                "mask_path": item["mask_path"],
                "mask_area_px": item["mask_area_px"],
            }
        )

    for key, value in status["timings"].items():
        status["timings"][key] = round(value, 6)

    return status


def main() -> None:
    parser = argparse.ArgumentParser(description="Run YOLOE + SAM2 segmentation, with optional Gemma4 correction review.")
    parser.add_argument("--workdir", type=Path, default=Path("runs/yoloe_sam_pipeline"))
    parser.add_argument("--image-dir", type=Path, help="Directory containing input images. Defaults to workdir/images.")
    parser.add_argument("--include-default-images", action="store_true", help="Download two Ultralytics sample images into image-dir.")
    parser.add_argument("--classes-file", type=Path, help="Newline-delimited text prompts/classes for YOLOE.")
    parser.add_argument("--device", default="0")
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--max-side", type=int, default=1280)
    parser.add_argument("--conf", type=float, default=0.25)
    parser.add_argument("--max-det", type=int, default=50)
    parser.add_argument("--sam-model", default="sam2_t.pt")
    parser.add_argument("--yoloe-prompt-free-model", default="yoloe-11s-seg-pf.pt")
    parser.add_argument("--yoloe-text-model", default="yoloe-11s-seg.pt")
    parser.add_argument("--gemma-review", action="store_true")
    parser.add_argument("--ollama-host", default="http://100.65.89.47:11434")
    parser.add_argument("--gemma-model", default="gemma4:latest")
    parser.add_argument("--gemma-timeout", type=int, default=180)
    args = parser.parse_args()

    image_dir = args.image_dir or args.workdir / "images"
    input_dir = args.workdir / "inputs_resized"
    out_dir = args.workdir / "outputs"
    masks_root = out_dir / "masks"
    out_dir.mkdir(parents=True, exist_ok=True)

    classes = read_classes(args.classes_file)
    image_paths = collect_images(image_dir, args.include_default_images)
    if not image_paths:
        raise SystemExit(f"No images found in {image_dir}")
    input_images = resize_inputs(image_paths, input_dir, args.max_side)

    prompt_free = YOLOE(args.yoloe_prompt_free_model)
    text_prompted = YOLOE(args.yoloe_text_model)
    text_prompted.set_classes(classes)
    sam = SAM(args.sam_model)

    summary: dict[str, Any] = {
        "models": {
            "yoloe_prompt_free": args.yoloe_prompt_free_model,
            "yoloe_text": args.yoloe_text_model,
            "sam": args.sam_model,
            "gemma": args.gemma_model if args.gemma_review else None,
        },
        "classes": classes,
        "images": {},
    }
    all_instances = []

    for image_path in input_images:
        stem = image_path.stem

        pf_result, pf_seconds = run_predict(
            prompt_free,
            image_path,
            device=args.device,
            imgsz=args.imgsz,
            conf=args.conf,
            max_det=args.max_det,
        )
        pf_detections = detections_from_result(pf_result, f"{stem}_pf")
        draw_boxes(image_path, pf_detections, out_dir / f"{stem}_yoloe_prompt_free_boxes.jpg")
        pf_result.save(filename=str(out_dir / f"{stem}_yoloe_prompt_free_masks.jpg"))

        text_result, text_seconds = run_predict(
            text_prompted,
            image_path,
            device=args.device,
            imgsz=args.imgsz,
            conf=args.conf,
            max_det=args.max_det,
        )
        text_detections = detections_from_result(text_result, f"{stem}_text")
        draw_boxes(image_path, text_detections, out_dir / f"{stem}_yoloe_text_boxes.jpg")
        text_result.save(filename=str(out_dir / f"{stem}_yoloe_text_masks.jpg"))

        sam_result, sam_seconds = run_sam_boxes(sam, image_path, text_detections, args.device)
        if sam_result is not None:
            instances = save_masks_and_overlay(
                image_path,
                sam_result,
                text_detections,
                masks_root / stem,
                out_dir / f"{stem}_sam2_from_yoloe_boxes.jpg",
            )
        else:
            instances = []

        for instance in instances:
            instance["image"] = image_path.name
            instance["image_path"] = str(image_path)
        all_instances.extend(instances)

        gemma = None
        if args.gemma_review:
            gemma = call_gemma4_review(args.ollama_host, args.gemma_model, image_path, text_detections, args.gemma_timeout)

        summary["images"][image_path.name] = {
            "prompt_free": {
                "seconds": pf_seconds,
                "detections": pf_detections,
                "mask_count": mask_count(pf_result),
            },
            "text_prompted": {
                "seconds": text_seconds,
                "detections": text_detections,
                "mask_count": mask_count(text_result),
            },
            "sam2_from_text_boxes": {
                "seconds": sam_seconds,
                "mask_count": len(instances),
                "instances": instances,
            },
            "gemma_review": gemma,
        }

    summary["global_status"] = build_global_status(summary, all_instances)
    (out_dir / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    (out_dir / "global_status.json").write_text(json.dumps(summary["global_status"], indent=2), encoding="utf-8")
    (out_dir / "instances.json").write_text(json.dumps(all_instances, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()

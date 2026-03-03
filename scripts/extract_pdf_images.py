#!/usr/bin/env python3
"""
Extract embedded images from a PDF file using pdfplumber + pdfminer + Pillow.
Outputs JSON to stdout:
  { "images": [{ "page": 1, "index": 0, "width": 300, "height": 200,
                  "format": "jpeg", "data_base64": "..." }] }

Usage: python3 extract_pdf_images.py <pdf_path>

Filters:
  - Skips images smaller than 50x50 px (decorative/icons)
  - Limits to 20 images max per PDF
  - Deduplicates by image stream hash
"""

import base64
import hashlib
import io
import json
import sys

import pdfplumber
from PIL import Image


MIN_DIMENSION = 50      # Skip images smaller than 50x50
MAX_IMAGES = 20         # Max images to extract per PDF
MAX_IMAGE_BYTES = 5_000_000  # Skip images > 5 MB raw data


def extract_image_from_stream(stream_obj):
    """
    Attempt to extract an image from a pdfminer stream object.
    Returns (PIL.Image, raw_bytes) or (None, None) on failure.
    """
    try:
        data = stream_obj.get_rawdata()
        if not data:
            return None, None

        # Try to detect format and decode
        attrs = stream_obj.attrs if hasattr(stream_obj, "attrs") else {}
        width = int(attrs.get("Width", 0))
        height = int(attrs.get("Height", 0))
        color_space = attrs.get("ColorSpace")
        bits = int(attrs.get("BitsPerComponent", 8))
        filters = attrs.get("Filter", [])

        # Normalise filters to a list
        if isinstance(filters, str):
            filters = [filters]
        elif hasattr(filters, "resolve"):
            filters = [filters]

        filter_names = []
        for f in filters:
            name = f
            if hasattr(f, "name"):
                name = f.name
            elif hasattr(f, "resolve"):
                name = str(f)
            filter_names.append(str(name))

        # DCTDecode = JPEG, JPXDecode = JPEG2000, FlateDecode = raw/PNG-ish,
        # CCITTFaxDecode = TIFF-like fax
        is_jpeg = any("DCTDecode" in fn for fn in filter_names)
        is_jpx = any("JPXDecode" in fn for fn in filter_names)

        if is_jpeg or is_jpx:
            # Data is already in JPEG/JPEG2000 format
            try:
                img = Image.open(io.BytesIO(data))
                return img, data
            except Exception:
                return None, None

        # For FlateDecode and raw streams, try to reconstruct the image
        if width > 0 and height > 0:
            try:
                # Try opening as-is first (some streams have valid headers)
                img = Image.open(io.BytesIO(data))
                return img, data
            except Exception:
                pass

            # Try raw pixel data reconstruction
            try:
                # Determine colour mode
                cs_str = str(color_space) if color_space else ""
                if "RGB" in cs_str:
                    mode = "RGB"
                    expected = width * height * 3
                elif "CMYK" in cs_str:
                    mode = "CMYK"
                    expected = width * height * 4
                elif "Gray" in cs_str or bits == 1:
                    mode = "L"
                    expected = width * height
                else:
                    mode = "RGB"
                    expected = width * height * 3

                if len(data) >= expected and expected > 0:
                    img = Image.frombytes(mode, (width, height), data[:expected])
                    return img, None
            except Exception:
                pass

        return None, None
    except Exception:
        return None, None


def image_to_base64(img, original_data=None, is_jpeg=False):
    """
    Convert a PIL Image to base64, preserving JPEG if possible.
    Returns (base64_str, format_name).
    """
    # If we have original JPEG data, use it directly
    if original_data and is_jpeg:
        return base64.b64encode(original_data).decode("ascii"), "jpeg"

    # Otherwise, encode to JPEG (for photos) or PNG (for images with alpha)
    buf = io.BytesIO()
    if img.mode in ("RGBA", "LA", "PA"):
        img.save(buf, format="PNG", optimize=True)
        fmt = "png"
    else:
        # Convert to RGB if needed
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")
        img.save(buf, format="JPEG", quality=85, optimize=True)
        fmt = "jpeg"

    buf.seek(0)
    return base64.b64encode(buf.read()).decode("ascii"), fmt


def main():
    if len(sys.argv) != 2:
        print(
            json.dumps({"images": [], "error": "Usage: extract_pdf_images.py <pdf_path>"}),
            flush=True,
        )
        sys.exit(1)

    pdf_path = sys.argv[1]

    try:
        images_out = []
        seen_hashes = set()
        total_extracted = 0

        with pdfplumber.open(pdf_path) as pdf:
            for page_num, page in enumerate(pdf.pages, start=1):
                if total_extracted >= MAX_IMAGES:
                    break

                # Access the underlying pdfminer page object
                pdf_page = page.page_obj

                # Walk the page's resources for XObject images
                resources = pdf_page.resources if hasattr(pdf_page, "resources") else {}
                if not resources:
                    try:
                        from pdfminer.pdftypes import resolve1
                        resources = resolve1(pdf_page.attrs.get("Resources", {})) or {}
                    except Exception:
                        continue

                xobjects = {}
                try:
                    from pdfminer.pdftypes import resolve1
                    xobj_dict = resources.get("XObject", {})
                    if hasattr(xobj_dict, "resolve"):
                        xobj_dict = resolve1(xobj_dict)
                    if isinstance(xobj_dict, dict):
                        xobjects = xobj_dict
                except Exception:
                    continue

                img_index = 0
                for name, obj_ref in xobjects.items():
                    if total_extracted >= MAX_IMAGES:
                        break

                    try:
                        from pdfminer.pdftypes import resolve1, stream_value
                        obj = resolve1(obj_ref)
                        if not obj:
                            continue

                        # Check it's an image
                        subtype = resolve1(obj.get("Subtype", None))
                        if subtype is None:
                            continue
                        subtype_name = str(subtype)
                        if hasattr(subtype, "name"):
                            subtype_name = subtype.name
                        if "Image" not in subtype_name:
                            continue

                        # Get dimensions
                        w = int(resolve1(obj.get("Width", 0)))
                        h = int(resolve1(obj.get("Height", 0)))

                        # Filter tiny images
                        if w < MIN_DIMENSION or h < MIN_DIMENSION:
                            continue

                        # Get raw data
                        raw_data = obj.get_rawdata()
                        if not raw_data:
                            try:
                                raw_data = obj.get_data()
                            except Exception:
                                continue

                        if not raw_data or len(raw_data) < 100:
                            continue

                        if len(raw_data) > MAX_IMAGE_BYTES:
                            continue

                        # Deduplicate by hash
                        data_hash = hashlib.md5(raw_data[:4096]).hexdigest()
                        if data_hash in seen_hashes:
                            continue
                        seen_hashes.add(data_hash)

                        # Determine if JPEG
                        filters = obj.get("Filter", [])
                        if isinstance(filters, str):
                            filters = [filters]
                        elif hasattr(filters, "resolve"):
                            filters = [resolve1(filters)]

                        filter_names = []
                        for f in filters:
                            fn = f
                            if hasattr(f, "name"):
                                fn = f.name
                            filter_names.append(str(fn))

                        is_jpeg = any("DCTDecode" in fn for fn in filter_names)
                        is_jpx = any("JPXDecode" in fn for fn in filter_names)

                        # Try to create PIL Image
                        img = None
                        if is_jpeg or is_jpx:
                            try:
                                img = Image.open(io.BytesIO(raw_data))
                            except Exception:
                                continue
                        else:
                            # Try decoded data
                            try:
                                decoded = obj.get_data()
                                if decoded:
                                    try:
                                        img = Image.open(io.BytesIO(decoded))
                                    except Exception:
                                        # Try raw pixel reconstruction
                                        cs = obj.get("ColorSpace")
                                        cs_str = ""
                                        if cs:
                                            cs_resolved = resolve1(cs)
                                            cs_str = str(cs_resolved)
                                            if hasattr(cs_resolved, "name"):
                                                cs_str = cs_resolved.name
                                            elif isinstance(cs_resolved, list) and len(cs_resolved) > 0:
                                                first = resolve1(cs_resolved[0])
                                                cs_str = str(first)
                                                if hasattr(first, "name"):
                                                    cs_str = first.name

                                        bits_per = int(resolve1(obj.get("BitsPerComponent", 8)))

                                        if "RGB" in cs_str:
                                            mode = "RGB"
                                            expected = w * h * 3
                                        elif "CMYK" in cs_str:
                                            mode = "CMYK"
                                            expected = w * h * 4
                                        elif "Gray" in cs_str or bits_per == 1:
                                            if bits_per == 1:
                                                mode = "1"
                                                expected = (w * h + 7) // 8
                                            else:
                                                mode = "L"
                                                expected = w * h
                                        else:
                                            mode = "RGB"
                                            expected = w * h * 3

                                        if len(decoded) >= expected > 0:
                                            img = Image.frombytes(mode, (w, h), decoded[:expected])
                            except Exception:
                                continue

                        if img is None:
                            continue

                        # Get actual dimensions from the image
                        actual_w, actual_h = img.size
                        if actual_w < MIN_DIMENSION or actual_h < MIN_DIMENSION:
                            continue

                        # Encode to base64
                        b64_data, fmt = image_to_base64(img, raw_data if is_jpeg else None, is_jpeg)

                        images_out.append({
                            "page": page_num,
                            "index": img_index,
                            "width": actual_w,
                            "height": actual_h,
                            "format": fmt,
                            "data_base64": b64_data,
                        })

                        img_index += 1
                        total_extracted += 1

                    except Exception:
                        continue

        print(json.dumps({"images": images_out}), flush=True)

    except Exception as e:
        print(json.dumps({"images": [], "error": str(e)}), flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()

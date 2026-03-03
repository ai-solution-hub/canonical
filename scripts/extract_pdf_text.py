#!/usr/bin/env python3
"""
Extract text and tables from a PDF file using pdfplumber.
Outputs JSON to stdout:
  { "text": "...", "page_count": N, "tables": [...], "table_count": N }

Usage: python3 extract_pdf_text.py /path/to/file.pdf
"""

import json
import sys

import pdfplumber


def main():
    if len(sys.argv) != 2:
        print(json.dumps({"error": "Usage: extract_pdf_text.py <pdf_path>"}), file=sys.stderr)
        sys.exit(1)

    pdf_path = sys.argv[1]

    try:
        pages_text = []
        tables = []

        with pdfplumber.open(pdf_path) as pdf:
            page_count = len(pdf.pages)
            for i, page in enumerate(pdf.pages):
                text = page.extract_text()
                if text:
                    pages_text.append(text)

                # Extract tables from this page
                page_tables = page.extract_tables()
                for j, table in enumerate(page_tables):
                    if table and len(table) > 1:  # At least header + 1 row
                        headers = [str(cell or "").strip() for cell in table[0]]
                        rows = []
                        for row in table[1:]:
                            rows.append([str(cell or "").strip() for cell in row])
                        tables.append({
                            "page": i + 1,
                            "table_index": j,
                            "headers": headers,
                            "rows": rows,
                            "row_count": len(rows),
                        })

        full_text = "\n\n".join(pages_text)

        result = {
            "text": full_text,
            "page_count": page_count,
            "tables": tables,
            "table_count": len(tables),
        }

        print(json.dumps(result))

    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()

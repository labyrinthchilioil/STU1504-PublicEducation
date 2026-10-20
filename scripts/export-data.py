"""Export Frame 12 without rewriting its content or filling absent source fields.

Run from any directory: python scripts/export-data.py
Dependency: openpyxl (see scripts/requirements.txt).
"""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import hashlib
import json
import math
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET

import openpyxl


ROOT = Path(__file__).resolve().parents[1]
SECTIONS = ("Description", "Evidence", "Time Scope", "Public Influence")
TABLES = {
    "Nodes": "nodes", "Connections": "connections", "Evidence_Links": "evidenceLinks",
    "Canvas_Items": "canvasItems", "Layout": "layout", "Groups": "groups",
    "Sidebar_Blocks": "sidebarBlocks", "Raw_Items": "rawItems", "Fidelity": "fidelity",
    "ReadMe": "readme",
}
EXPECTED = {
    "Nodes": 128, "Connections": 181, "Evidence_Links": 144, "Canvas_Items": 131,
    "Layout": 259, "Groups": 116, "Sidebar_Blocks": 639, "Raw_Items": 440,
    "Fidelity": 13, "ReadMe": 44,
}
ID_FIELDS = {
    "node_id", "start_node_id", "end_node_id", "group_id", "detail_text_id",
    "source_text_id", "item_id", "connection_id", "parent_frame_id",
}


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workbook", type=Path, default=ROOT / "database/Frame12_Database.xlsx")
    parser.add_argument("--source-svg", type=Path, default=ROOT / "source/miro-frame12.svg")
    parser.add_argument("--output", type=Path, default=ROOT / "web/data")
    args = parser.parse_args()
    workbook = openpyxl.load_workbook(args.workbook, read_only=True, data_only=False)
    tables = {}
    errors = []
    checks = []

    def check(name, passed, **details):
        checks.append({"check": name, "passed": bool(passed), **details})
        if not passed:
            errors.append(name)

    for name, expected in EXPECTED.items():
        sheet = workbook[name]
        iterator = sheet.iter_rows(values_only=True)
        headers = next(iterator)
        rows = [dict(zip(headers, values)) for values in iterator]
        tables[name] = rows
        check(f"{name}: source row count", len(rows) == expected, expected=expected, actual=len(rows))
        for index, row in enumerate(rows, 2):
            for field in ID_FIELDS.intersection(row):
                value = row[field]
                if value is not None and not (isinstance(value, str) and re.fullmatch(r"\d{19}", value)):
                    errors.append(f"{name}!{field}:{index}: invalid string ID {value!r}")
            if any(isinstance(value, str) and value.startswith("=") for value in row.values()):
                errors.append(f"{name}:{index}: unexpected formula")
    workbook.close()

    def unique_index(name, key):
        rows = tables[name]
        result = {row[key]: row for row in rows}
        check(f"{name}: unique {key}", len(result) == len(rows), actual=len(result))
        return result

    nodes = unique_index("Nodes", "node_id")
    connections = unique_index("Connections", "connection_id")
    layout = unique_index("Layout", "item_id")
    canvas = unique_index("Canvas_Items", "item_id")
    raw = unique_index("Raw_Items", "item_id")
    groups = unique_index("Groups", "group_id")
    unique_index("Sidebar_Blocks", "block_id")
    unique_index("Evidence_Links", "link_id")
    expected_items = set(nodes) | set(connections) | set(canvas)
    check("Raw archive exactly covers nodes, connectors and canvas items", set(raw) == expected_items)
    check("Layout exactly covers every non-connector item", set(layout) == set(nodes) | set(canvas))
    endpoints = [edge[field] for edge in connections.values() for field in ("start_node_id", "end_node_id")]
    check("All 362 connector endpoints reference source nodes", len(endpoints) == 362 and all(x in nodes for x in endpoints), actual=len(endpoints))
    check("All connector directions are start to end", all(edge["direction"] == "start_to_end" for edge in connections.values()))
    check("Missing routes and label positions remain absent", all(edge[field] is None for edge in connections.values() for field in ("path_data", "bend_points", "label_x", "label_y")))
    check("All fixed geometry values are present and numeric", all(isinstance(row[field], (int, float)) for row in layout.values() for field in ("x", "y", "width", "height")))
    check("Node labels preserve source HTML", all(node["label_html"] == raw[node_id]["content_html"] for node_id, node in nodes.items()))
    check("Canvas items preserve source HTML", all(item["source_html"] == raw[item_id]["content_html"] for item_id, item in canvas.items()))
    check("Connection labels preserve source HTML", all(edge["label_html"] == raw[edge_id]["content_html"] for edge_id, edge in connections.items()))

    geometry_matches = 0
    typography_matches = 0
    for item_id, row in layout.items():
        source_row = raw[item_id]
        attributes = json.loads(source_row["attributes_json"])
        bounds = json.loads(source_row["frame_rect_attributes_json"]) if row["role"] == "frame" else attributes
        geometry_matches += int(all(math.isclose(row[field], float(bounds[field]), rel_tol=0, abs_tol=1e-9) for field in ("x", "y", "width", "height")))
        is_text = source_row["source_tag"] == "textArea"
        source_text_styles = {
            "text_color": attributes.get("fill" if is_text else "data-text-color"),
            "font_family": attributes.get("font-family" if is_text else "data-font-family"),
            "text_align": attributes.get("text-align" if is_text else "data-text-align"),
            "vertical_align": attributes.get("data-text-align-vertical"),
            "font_weight": attributes.get("font-weight" if is_text else "data-font-weight"),
        }
        exact = all(row[field] == value for field, value in source_text_styles.items())
        for field, attribute in (("font_size", "font-size" if is_text else "data-font-size"), ("border_width", "stroke-width"), ("rotation_degrees", "data-rotation")):
            value = attributes.get(attribute)
            exact &= row[field] == (float(value) if value is not None else None)
        typography_matches += int(exact)
    check("All 259 item geometries match source attributes", geometry_matches == 259, actual=geometry_matches, numeric_tolerance=1e-9)
    check("All 259 typography, rotation and border width records match source", typography_matches == 259, actual=typography_matches)
    shape_matches = 0
    for node_id, node in nodes.items():
        attributes = json.loads(raw[node_id]["attributes_json"])
        shape_matches += int(node["shape"] == attributes.get("data-shape", "rectangle") and node["fill_color"] == attributes.get("fill") and node["border_color"] == attributes.get("stroke"))
    check("All 128 node shapes and colors match source", shape_matches == 128, actual=shape_matches)
    connector_style_matches = 0
    for edge_id, edge in connections.items():
        attributes = json.loads(raw[edge_id]["attributes_json"])
        exact = all(edge[field] == attributes.get(attribute) for field, attribute in (("line_color", "stroke"), ("line_type", "data-shape"), ("dash_array", "stroke-dasharray"), ("start_side", "data-start-side"), ("end_side", "data-end-side")))
        exact &= edge["line_width"] == float(attributes["stroke-width"])
        exact &= edge["start_node_id"] == attributes["data-start"].removeprefix("m") and edge["end_node_id"] == attributes["data-end"].removeprefix("m")
        exact &= attributes.get("data-arrow") == "end"
        connector_style_matches += int(exact)
    check("All 181 connector styles, directions and attachment IDs match source", connector_style_matches == 181, actual=connector_style_matches)

    node_groups = [group for group in groups.values() if group["group_type"] == "node_with_detail"]
    pairs_match = len(node_groups) == 115
    for group in node_groups:
        node = nodes.get(group["node_id"])
        detail = canvas.get(group["detail_text_id"])
        pairs_match &= bool(node and detail and node["group_id"] == group["group_id"] == detail["group_id"] and node["detail_text_id"] == detail["item_id"] and detail["node_id"] == node["node_id"])
        pairs_match &= set(json.loads(group["member_ids_json"])) == {group["node_id"], group["detail_text_id"]}
        pairs_match &= all(raw[member]["group_id"] == group["group_id"] for member in json.loads(group["member_ids_json"]))
    check("All 115 node-note associations match explicit groups", pairs_match, actual=len(node_groups))

    blocks_by_node = defaultdict(list)
    blocks_by_detail = defaultdict(list)
    for block in tables["Sidebar_Blocks"]:
        blocks_by_node[block["node_id"]].append(block)
        blocks_by_detail[block["detail_text_id"]].append(block)
        node = nodes.get(block["node_id"])
        if not (node and node["detail_text_id"] == block["detail_text_id"] and node["group_id"] == block["group_id"] and block["section"] in SECTIONS):
            errors.append(f"Invalid sidebar association: {block['block_id']}")
    reconstructed = 0
    section_text_matches = 0
    for detail_id, blocks in blocks_by_detail.items():
        source_html = raw[detail_id]["content_html"]
        sorted_blocks = sorted(blocks, key=lambda row: row["block_order"])
        intact = "".join(block["source_html_fragment"] for block in sorted_blocks) == source_html
        intact &= all(source_html[block["source_start"]:block["source_end"]] == block["source_html_fragment"] for block in blocks)
        reconstructed += int(intact)
    check("Sidebar fragments reconstruct all 115 original notes exactly", reconstructed == 115, actual=reconstructed)
    for node_id, node in nodes.items():
        for section in SECTIONS:
            text = "\n\n".join(block["text"] for block in sorted(blocks_by_node[node_id], key=lambda row: row["block_order"]) if block["section"] == section and block["text"])
            section_text_matches += int(text == (node[section] or ""))
    check("All 512 node section text values match their sidebar blocks", section_text_matches == 512, actual=section_text_matches)

    links_by_node = defaultdict(list)
    links_by_item = defaultdict(list)
    links_exact = 0
    links_owned = 0
    for link in tables["Evidence_Links"]:
        source = raw[link["source_text_id"]]
        links_by_item[link["source_text_id"]].append(link)
        if link["node_id"]:
            links_by_node[link["node_id"]].append(link)
            node = nodes.get(link["node_id"])
            links_owned += int(bool(node and node["detail_text_id"] == link["source_text_id"] and node["group_id"] == link["group_id"]))
        else:
            links_owned += int(source["role"] == "standalone_note" and link["group_id"] is None)
        links_exact += int(source["content_html"][link["source_start"]:link["source_end"]] == link["source_link_html"])
    check("All 144 link fragments match exact original HTML offsets", links_exact == 144, actual=links_exact)
    check("All 144 link occurrences retain exact source ownership", links_owned == 144, actual=links_owned)
    absent_nodes = [node for node in nodes.values() if node["detail_text_id"] is None]
    check("13 nodes without grouped notes retain empty sections", len(absent_nodes) == 13 and all(not node[section] for node in absent_nodes for section in SECTIONS), actual=len(absent_nodes))
    standalone_notes = [item for item in canvas.values() if item["role"] == "standalone_note"]
    check("Two standalone notes remain unassigned", len(standalone_notes) == 2 and all(item["node_id"] is None and item["group_id"] is None for item in standalone_notes))

    live_comparison = {"available": args.source_svg.is_file()}
    if args.source_svg.is_file():
        source_root = ET.parse(args.source_svg).getroot()
        source_items = {element.attrib["data-miro-id"]: element for element in source_root.iter() if "data-miro-id" in element.attrib}
        check("Live Miro export item IDs match all 440 archived items", set(source_items) == set(raw), actual=len(source_items))
        mismatches = []
        for item_id, row in raw.items():
            element = source_items.get(item_id)
            if element is None:
                mismatches.append({"item_id": item_id, "field": "missing"})
                continue
            if element.attrib != json.loads(row["attributes_json"]):
                mismatches.append({"item_id": item_id, "field": "attributes"})
            tag = element.tag.rsplit("}", 1)[-1]
            content = element.attrib.get("data-frame") if row["role"] == "frame" else element.text if tag == "textArea" else element.attrib.get("data-content")
            if content != row["content_html"]:
                mismatches.append({"item_id": item_id, "field": "content_html"})
            if row["role"] == "frame":
                frame_rect = next(child for child in element if child.attrib.get("data-type") == "frame")
                if frame_rect.attrib != json.loads(row["frame_rect_attributes_json"]):
                    mismatches.append({"item_id": item_id, "field": "frame_rect_attributes"})
        check("Live Miro export attributes and authored HTML match workbook", not mismatches, mismatches=mismatches)
        live_comparison.update({"file": "source/miro-frame12.svg", "sha256": hashlib.sha256(args.source_svg.read_bytes()).hexdigest(), "item_count": len(source_items), "mismatches": mismatches})

    exported = {target: tables[source] for source, target in TABLES.items()}
    exported["nodes"] = [{**node, "layout": layout[node["node_id"]], "sections": {section: sorted([block for block in blocks_by_node[node["node_id"]] if block["section"] == section], key=lambda row: row["block_order"]) for section in SECTIONS}, "evidence_links": links_by_node[node["node_id"]]} for node in tables["Nodes"]]
    exported["canvasItems"] = [{**item, "layout": layout[item["item_id"]], "evidence_links": links_by_item[item["item_id"]]} for item in tables["Canvas_Items"]]
    frame = next(item for item in exported["canvasItems"] if item["role"] == "frame")
    readme = {row["topic"]: row["instruction"] for row in tables["ReadMe"]}
    source = {
        "workbook": args.workbook.name,
        "workbook_sha256": hashlib.sha256(args.workbook.read_bytes()).hexdigest(),
        "url": readme["Exact source"],
        "snapshot": readme["Snapshot"],
        "section_order": list(SECTIONS),
        "counts": {TABLES[name]: len(rows) for name, rows in tables.items()},
    }
    result = {"schema_version": 1, "source": source, "frame": frame, **exported}
    report = {
        "status": "passed" if not errors else "failed",
        "workbook_sha256": source["workbook_sha256"],
        "counts": source["counts"],
        "node_shapes": dict(Counter(node["shape"] for node in nodes.values())),
        "connector_types": dict(Counter(edge["line_type"] for edge in connections.values())),
        "valid_endpoint_references": sum(x in nodes for x in endpoints),
        "explicit_node_note_pairs": len(node_groups),
        "distinct_evidence_urls": len({link["url"] for link in tables["Evidence_Links"]}),
        "unresolved_visual_fidelity": [row for row in tables["Fidelity"] if row["status"] in ("visual_reference_required", "not_exposed")],
        "live_miro_comparison": live_comparison,
        "checks": checks,
        "errors": errors,
    }
    write_json(args.output / "integrity.json", report)
    if errors:
        print(json.dumps({"status": "failed", "errors": errors}, indent=2))
        return 1
    write_json(args.output / "frame12.json", result)
    print(json.dumps({"status": "passed", "counts": source["counts"], "checks": len(checks), "live_miro_match": live_comparison.get("mismatches") == [], "output": str(args.output)}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())

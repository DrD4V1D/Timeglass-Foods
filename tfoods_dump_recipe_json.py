#!/usr/bin/env python3
"""
Timeglass Foods – Recipe & Registry Sync (skeleton)

This script will:
- Scan mod jars and datapacks for recipe JSON
- Extract direct (non-recursive) ingredient tokens per output item
- Ingest a runtime-generated edible item list
- Synchronize a per-node registry without overwriting manual buffs
- Emit generated, machine-owned summary artifacts

This file currently contains ONLY structure and intent.
Implementation will be filled incrementally.
"""

from __future__ import annotations

import argparse
import json
import sys
import zipfile
from pathlib import Path
from typing import Any, Dict, Iterable, Iterator, List, Set, Tuple


# ------------------------------------------------------------------------------
# CLI and orchestration
# ------------------------------------------------------------------------------

def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """
    Parse command-line arguments.

    Defines all external inputs/outputs for the sync process.
    This function should remain stable as the rest of the script evolves.
    """
    p = argparse.ArgumentParser(
        prog="tfoods_dump_recipe_json.py",
        description="Timeglass Foods – recipe scanning and registry sync",
    )

    p.add_argument(
        "--edibles",
        type=Path,
        required=True,
        help="Path to runtime-generated edible items JSON (from KubeJS)",
    )

    p.add_argument(
        "--inputs",
        type=Path,
        nargs="+",
        required=True,
        help="One or more inputs (mod jars or datapack folders) to scan for recipes",
    )

    p.add_argument(
        "--registry",
        type=Path,
        required=True,
        help="Registry root directory (contains nodes/ and generated/)",
    )

    p.add_argument(
        "--direct-map-out",
        type=Path,
        default=None,
        help="Optional path to write the direct ingredient map JSON",
    )

    p.add_argument(
        "--dry-run",
        action="store_true",
        help="Run without writing any files",
    )

    p.add_argument(
        "--verbose",
        action="store_true",
        help="Enable verbose logging",
    )

    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    """
    High-level orchestration entrypoint.

    This function intentionally contains no domain logic.
    It wires together the major phases of the pipeline.
    """
    args = parse_args(argv)

    # Normalize and sanity-check paths early
    args.edibles = args.edibles.resolve()
    args.registry = args.registry.resolve()
    args.inputs = [p.resolve() for p in args.inputs]

    if not args.edibles.exists():
        print(f"[ERROR] Edibles file not found: {args.edibles}", file=sys.stderr)
        return 2

    for p in args.inputs:
        if not p.exists():
            print(f"[ERROR] Input path not found: {p}", file=sys.stderr)
            return 2

    # Registry layout (convention, not enforced yet)
    nodes_dir = args.registry / "nodes"
    generated_dir = args.registry / "generated"

    if not args.dry_run:
        nodes_dir.mkdir(parents=True, exist_ok=True)
        generated_dir.mkdir(parents=True, exist_ok=True)

    # --- Pipeline stages (to be implemented incrementally) ---

    # 1. Scan recipes from inputs
    sources = discover_recipe_sources(args.inputs)
    recipes = iter_all_recipe_json_from_sources(sources)

    # 2. Build direct ingredient map
    direct_map = build_direct_map(recipes, verbose=args.verbose)

    if args.verbose:
        print(f"[INFO] direct_map outputs: {len(direct_map)}")

    # Optional: write direct_map for inspection / downstream use
    if args.direct_map_out is not None:
        if args.dry_run:
            if args.verbose:
                print(f"[DRY-RUN] Would write direct_map to: {args.direct_map_out}")
        else:
            args.direct_map_out.parent.mkdir(parents=True, exist_ok=True)
            write_json(args.direct_map_out, direct_map)
            if args.verbose:
                print(f"[INFO] Wrote direct_map to: {args.direct_map_out}")

    # 3. Load edible masterlist
    edible_items = load_edible_items(args.edibles)

    # 4. Sync registry nodes (preserve assigned buffs)
    if args.verbose:
        print("[INFO] Registry sync is not implemented yet; skipping step 4.")
    # stats = sync_registry_nodes(
    #     registry_dir=args.registry,
    #     expected_nodes=...,
    #     direct_map=direct_map,
    #     edible=edible_items,
    # )

    # 5. Write generated outputs
    outputs_set = set(direct_map.keys())
    edible_outputs = outputs_set.intersection(edible_items)

    gen_stats = {
        "direct_map_output_count": len(outputs_set),
        "edible_item_count": len(edible_items),
        "edible_output_count": len(edible_outputs),
    }

    if args.dry_run:
        if args.verbose:
            print(f"[DRY-RUN] Would write generated foods/stats to: {generated_dir}")
    else:
        write_generated_food_list(generated_dir, edible_outputs)
        write_generated_stats(generated_dir, gen_stats)

        if args.verbose:
            print(f"[INFO] Generated foods.json + stats.json in: {generated_dir}")
            print(f"[INFO] edible_output_count: {len(edible_outputs)}")

    if args.verbose:
        print("[INFO] Pipeline completed (skeleton run)")

    return 0


# ------------------------------------------------------------------------------
# JSON utilities
# ------------------------------------------------------------------------------

def read_json(path: Path) -> Any:
    """
    Read JSON from disk with strict errors.
    """
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def write_json(path: Path, obj: Any) -> None:
    """
    Write deterministic JSON to disk.

    - sorted keys
    - stable indentation
    - newline at EOF
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")

    with tmp.open("w", encoding="utf-8", newline="\n") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2, sort_keys=True)
        f.write("\n")

    tmp.replace(path)


def parse_json_lenient(raw: str) -> Any:
    """
    Parse JSON text leniently.

    This will eventually tolerate:
    - trailing garbage
    - minor formatting issues

    Intended for third-party recipe JSON.
    """
    pass


# ------------------------------------------------------------------------------
# Recipe discovery
# ------------------------------------------------------------------------------

def discover_recipe_sources(inputs: List[Path]) -> List[Path]:
    """
    Expand user-provided inputs into concrete scan targets.

    Supports:
    - mods folder: scans all *.jar/*.zip within it
    - server root folder (optional later): can expand to mods/ and datapacks/
    - jar file: scans that jar
    - datapack folder: scans that folder

    Returns a list of Paths that are either:
    - jar files
    - directories that contain data/**/recipes/**/*.json
    """
    sources: List[Path] = []

    for p in inputs:
        if p.is_file():
            # jar/zip or direct json folder? (file -> treat as jar if extension matches)
            if p.suffix.lower() in {".jar", ".zip"}:
                sources.append(p)
            else:
                # Not a supported file type (yet)
                continue
            continue

        if not p.is_dir():
            continue

        # If user points at the mods folder, scan all jars in it.
        if p.name.lower() == "mods":
            for jar in sorted(p.glob("*.jar")):
                sources.append(jar)
            for z in sorted(p.glob("*.zip")):
                sources.append(z)
            continue

        # Otherwise treat directory as a datapack-style root and scan it as-is.
        # (Later we can optionally detect "server root" and auto-add world/datapacks, etc.)
        sources.append(p)

    return sources

def is_recipe_json_path(rel_path: str) -> bool:
    """
    Return True if a path looks like a Minecraft recipe JSON location:
      data/<namespace>/recipes/.../*.json
    """
    rp = rel_path.replace("\\", "/")
    if not rp.endswith(".json"):
        return False
    if "/data/" not in f"/{rp}":
        return False
    return "/recipes/" in rp

def iter_recipe_json_from_jar(jar_path: Path) -> Iterator[Tuple[str, str, dict]]:
    """
    Yield recipe JSON objects from a mod jar.

    Yields:
      (source_id, relative_path, parsed_json)

    - source_id: jar filename (for provenance/debug)
    - relative_path: the internal jar path (e.g. data/minecraft/recipes/foo.json)
    - parsed_json: dict parsed from JSON
    """
    source_id = jar_path.name

    try:
        with zipfile.ZipFile(jar_path, "r") as zf:
            for name in zf.namelist():
                if not is_recipe_json_path(name):
                    continue

                try:
                    raw = zf.read(name).decode("utf-8")
                except Exception:
                    continue

                try:
                    # Start strict; you can swap to parse_json_lenient(raw) later.
                    obj = json.loads(raw)
                except Exception:
                    continue

                if isinstance(obj, dict):
                    yield (source_id, name, obj)

    except zipfile.BadZipFile:
        return

def iter_recipe_json_from_folder(root: Path) -> Iterator[Tuple[str, str, dict]]:
    """
    Yield recipe JSON objects from a datapack or folder.

    Expected structure:
      <root>/data/<namespace>/recipes/**/*.json

    Yields:
      (source_id, relative_path, parsed_json)
    """
    source_id = str(root)

    data_dir = root / "data"
    if not data_dir.exists():
        return

    # Iterate only recipe json files
    for path in sorted(data_dir.rglob("*.json")):
        rel = path.relative_to(root).as_posix()
        if "/recipes/" not in rel:
            continue

        try:
            raw = path.read_text(encoding="utf-8")
        except Exception:
            continue

        try:
            obj = json.loads(raw)
        except Exception:
            continue

        if isinstance(obj, dict):
            yield (source_id, rel, obj)

def iter_all_recipe_json_from_sources(
    sources: List[Path],
) -> Iterator[Tuple[str, str, dict]]:
    """
    Yield all recipe JSON objects from concrete sources.

    Sources must already be expanded and consist of:
    - jar files
    - datapack-style directories
    """
    for src in sources:
        if src.is_file() and src.suffix.lower() in {".jar", ".zip"}:
            yield from iter_recipe_json_from_jar(src)
        elif src.is_dir():
            yield from iter_recipe_json_from_folder(src)

# ------------------------------------------------------------------------------
# Direct map construction
# ------------------------------------------------------------------------------
def build_direct_map(
    recipes: Iterable[Tuple[str, str, dict]],
    *,
    verbose: bool = False,
) -> Dict[str, List[str]]:
    """
    Build the direct ingredient map from streamed recipe JSON.

    Produces:
      { "output:item_id": ["item:...", "tag:...", "fluid:...", ...], ... }

    No recursion, no expansion, no edibility filtering.
    """
    direct_map: Dict[str, Set[str]] = {}

    for source_id, rel_path, recipe in recipes:
        outputs = extract_outputs(recipe)
        if not outputs:
            continue

        tokens = extract_direct_ingredient_tokens(recipe)
        if not tokens:
            # It's okay: some recipes are weird or represent transforms
            continue

        # Normalize tokens early to reduce churn
        tokens = [canonicalize_token(t) for t in tokens]

        merge_direct_map(direct_map, outputs, tokens)

    return finalize_direct_map(direct_map)

# ------------------------------------------------------------------------------
# Recipe normalization
# ------------------------------------------------------------------------------

def extract_outputs(recipe: dict) -> Set[str]:
    """
    Extract output item IDs from a recipe JSON.

    Returns a set of item IDs like {"minecraft:bread"}.

    Supported (common) shapes:
    - {"result": "minecraft:bread"}
    - {"result": {"item": "minecraft:bread", "count": 1}}
    - {"result": [{"item": "a"}, {"item": "b"}]}   (rare but seen in modded JSON)
    - {"results": [{"item": "a"}, {"item": "b"}]}
    - {"output": {...}} / {"outputs": [...] }     (modded variants)

    Notes:
    - This intentionally ignores tag-based outputs (rare/ambiguous) and
      non-item outputs (fluids, etc.) at this stage.
    - Extend here if you encounter a new output schema.
    """

    def is_item_id(s: Any) -> bool:
        return isinstance(s, str) and ":" in s and not s.startswith("#")

    def from_result_obj(obj: Any) -> Set[str]:
        out: Set[str] = set()

        if obj is None:
            return out

        # result: "mod:item"
        if is_item_id(obj):
            out.add(obj)
            return out

        # result: [{"item": "a"}, {"item": "b"}]
        if isinstance(obj, list):
            for el in obj:
                out |= from_result_obj(el)
            return out

        if not isinstance(obj, dict):
            return out

        # result: {"item": "mod:item", "count": N}
        item = obj.get("item")
        if is_item_id(item):
            out.add(item)

        # Some modded formats nest the item under other keys
        # e.g., {"result": {"id": "mod:item"}} or {"result": {"name": "mod:item"}}
        for k in ("id", "name"):
            v = obj.get(k)
            if is_item_id(v):
                out.add(v)

        # Very occasional: {"item": {"item": "mod:item"}} etc.
        for v in obj.values():
            if isinstance(v, (dict, list, str)):
                # keep it shallow to avoid accidentally grabbing ingredient items
                if isinstance(v, dict) and ("item" in v or "id" in v or "name" in v):
                    out |= from_result_obj(v)
                elif isinstance(v, list):
                    # only accept lists that look like result lists (dicts with item fields)
                    if any(isinstance(x, dict) and ("item" in x or "id" in x or "name" in x) for x in v):
                        out |= from_result_obj(v)

        return out

    outputs: Set[str] = set()

    if not isinstance(recipe, dict):
        return outputs

    # Vanilla + most modded
    if "result" in recipe:
        outputs |= from_result_obj(recipe.get("result"))

    # Common modded multi-output conventions
    if "results" in recipe:
        outputs |= from_result_obj(recipe.get("results"))

    if not outputs:
        # Some mods use "output"/"outputs"
        if "output" in recipe:
            outputs |= from_result_obj(recipe.get("output"))
        if "outputs" in recipe:
            outputs |= from_result_obj(recipe.get("outputs"))

    return outputs


def extract_direct_ingredient_tokens(recipe: dict) -> List[str]:
    """
    Extract direct ingredient tokens from a recipe JSON.

    Returns tokens like:
      - item:minecraft:wheat
      - tag:forge:dough
      - fluid:minecraft:water

    This function performs NO recursion and NO expansion.
    It only describes the recipe's declared direct inputs.

    Supported common schemas:
    - Shapeless: {"ingredients": [ ... ]}
    - Shaped: {"pattern": [...], "key": { "X": <ingredient>, ... }}
    - Single: {"ingredient": <ingredient>}
    - Modded variants: {"input": ...}, {"inputs": [...]}, {"ingredients": ...}

    Notes:
    - Any unknown/unsupported ingredient shapes are ignored (best-effort).
    - Some modded recipes encode fluids in many different ways; this handles a few
      common patterns but will likely need extension once you encounter specifics.
    """

    def is_item_id(s: Any) -> bool:
        return isinstance(s, str) and ":" in s and not s.startswith("#")

    def is_tag_id(s: Any) -> bool:
        return isinstance(s, str) and ":" in s and not s.startswith("#")

    def tag_from_hash(s: str) -> str | None:
        # Minecraft ingredient string tags are like "#forge:dough"
        if isinstance(s, str) and s.startswith("#") and ":" in s[1:]:
            return s[1:]
        return None

    def token_from_item_id(item_id: str) -> str:
        return f"item:{item_id}"

    def token_from_tag_id(tag_id: str) -> str:
        return f"tag:{tag_id}"

    def token_from_fluid_id(fluid_id: str) -> str:
        return f"fluid:{fluid_id}"

    def collect_from_ingredient_obj(obj: Any, out: List[str]) -> None:
        """
        Collect tokens from a Minecraft "Ingredient" JSON shape (best-effort).

        Typical shapes:
          - "minecraft:iron_ingot"
          - "#forge:ingots/iron"
          - {"item": "minecraft:iron_ingot"}
          - {"tag": "forge:ingots/iron"}
          - [{"item": ...}, {"tag": ...}]  (some recipes)
          - {"items": [{"item": ...}, ...]} (rare)
        """
        if obj is None:
            return

        # String: item id or #tag
        if isinstance(obj, str):
            t = tag_from_hash(obj)
            if t:
                out.append(token_from_tag_id(t))
            elif is_item_id(obj):
                out.append(token_from_item_id(obj))
            return

        # List: treat as OR of ingredient entries
        if isinstance(obj, list):
            for el in obj:
                collect_from_ingredient_obj(el, out)
            return

        if not isinstance(obj, dict):
            return

        # Standard {"item": "..."} / {"tag": "..."}
        if "item" in obj and is_item_id(obj.get("item")):
            out.append(token_from_item_id(obj["item"]))
        if "tag" in obj and is_tag_id(obj.get("tag")):
            out.append(token_from_tag_id(obj["tag"]))

        # Some mods use {"id": "..."} or {"name": "..."} for an item-like reference
        for k in ("id", "name"):
            v = obj.get(k)
            if is_item_id(v):
                out.append(token_from_item_id(v))

        # Rare: {"items": [ ... ]} as ingredient
        if "items" in obj and isinstance(obj["items"], list):
            for el in obj["items"]:
                collect_from_ingredient_obj(el, out)

    def collect_from_fluid_obj(obj: Any, out: List[str]) -> None:
        """
        Collect fluid tokens from common modded fluid ingredient shapes (best-effort).

        Common-ish shapes seen across mods:
          - {"fluid": "minecraft:water"}
          - {"fluids": ["minecraft:water", ...]}
          - {"fluidTag": "forge:water"}  (we normalize to tag:... or fluid:...?)
        """
        if obj is None:
            return
        if isinstance(obj, str):
            if is_item_id(obj):  # fluid id shape resembles item ids
                out.append(token_from_fluid_id(obj))
            return
        if isinstance(obj, list):
            for el in obj:
                collect_from_fluid_obj(el, out)
            return
        if not isinstance(obj, dict):
            return

        v = obj.get("fluid")
        if is_item_id(v):
            out.append(token_from_fluid_id(v))

        vs = obj.get("fluids")
        if isinstance(vs, list):
            for el in vs:
                if is_item_id(el):
                    out.append(token_from_fluid_id(el))

        # Some mods use fluid tags. We keep them as tag:... because they behave like tags.
        ft = obj.get("fluidTag") or obj.get("tag")
        if is_tag_id(ft):
            out.append(token_from_tag_id(ft))

    tokens: List[str] = []
    if not isinstance(recipe, dict):
        return tokens

    # Shaped recipes: pattern + key (key defines the direct ingredient set)
    if "pattern" in recipe and isinstance(recipe.get("key"), dict):
        key = recipe["key"]
        for ing in key.values():
            collect_from_ingredient_obj(ing, tokens)

    # Shapeless recipes: ingredients list
    if isinstance(recipe.get("ingredients"), list):
        for ing in recipe["ingredients"]:
            collect_from_ingredient_obj(ing, tokens)

    # Single ingredient recipes: ingredient object
    if "ingredient" in recipe:
        collect_from_ingredient_obj(recipe.get("ingredient"), tokens)

    # Modded variants: input / inputs (treat similarly)
    if "input" in recipe:
        collect_from_ingredient_obj(recipe.get("input"), tokens)
        collect_from_fluid_obj(recipe.get("input"), tokens)

    if isinstance(recipe.get("inputs"), list):
        for ing in recipe["inputs"]:
            collect_from_ingredient_obj(ing, tokens)
            collect_from_fluid_obj(ing, tokens)

    # Modded fluid fields (best-effort)
    for k in ("fluid", "fluids", "fluidIngredient", "fluid_ingredient"):
        if k in recipe:
            collect_from_fluid_obj(recipe.get(k), tokens)

    return tokens

def canonicalize_token(token: str) -> str:
    """
    Normalize an ingredient token into a canonical string form.

    Canonical forms:
      - item:<namespace>:<path>
      - tag:<namespace>:<path>
      - fluid:<namespace>:<path>

    This function is intentionally conservative:
    - no expansion
    - no validation against registries
    - no guessing

    It exists solely to collapse formatting variants.
    """
    if not isinstance(token, str):
        return token

    t = token.strip()

    # Already canonical
    if t.startswith(("item:", "tag:", "fluid:")):
        return t

    # Raw item id -> item:
    if ":" in t and not t.startswith("#"):
        return f"item:{t}"

    # Raw tag reference -> tag:
    if t.startswith("#") and ":" in t[1:]:
        return f"tag:{t[1:]}"

    return t

def merge_direct_map(
    direct_map: Dict[str, Set[str]],
    outputs: Set[str],
    tokens: List[str],
) -> None:
    """
    Merge direct ingredient tokens into the direct_map.

    direct_map maps:
      output_item_id -> set of direct ingredient tokens

    This function mutates direct_map in place.
    """
    if not outputs or not tokens:
        return

    for out in outputs:
        if out not in direct_map:
            direct_map[out] = set()
        direct_map[out].update(tokens)

def finalize_direct_map(
    direct_map: Dict[str, Set[str]]
) -> Dict[str, List[str]]:
    """
    Finalize the direct ingredient map for serialization.

    Converts sets to sorted lists for deterministic output.
    """
    finalized: Dict[str, List[str]] = {}

    for out, tokens in direct_map.items():
        finalized[out] = sorted(tokens)

    return finalized

# ------------------------------------------------------------------------------
# Edible masterlist ingestion
# ------------------------------------------------------------------------------

def load_edible_items(edibles_path: Path) -> Set[str]:
    """
    Load the runtime-generated edible item list.

    Expected shape:
      { "items": ["minecraft:apple", ...], ... }

    Returns a set of item IDs that are edible.
    """
    obj = read_json(edibles_path)
    if not isinstance(obj, dict):
        raise ValueError(f"Edibles JSON must be an object: {edibles_path}")

    items = obj.get("items")
    if not isinstance(items, list):
        raise ValueError(f'Edibles JSON missing "items" list: {edibles_path}')

    edible: Set[str] = set()
    for it in items:
        if isinstance(it, str) and ":" in it:
            edible.add(it)

    return edible

# ------------------------------------------------------------------------------
# Registry node I/O
# ------------------------------------------------------------------------------

def node_filename(item_id: str) -> str:
    """
    Convert an item ID into a filesystem-safe filename.

    Example:
      minecraft:bread -> minecraft__bread.json
    """
    pass


def load_node(path: Path) -> dict:
    """
    Load a registry node JSON from disk.

    Must preserve unknown fields and manual assignments.
    """
    pass


def new_node_template(item_id: str) -> dict:
    """
    Create a new registry node with minimal required structure.

    assigned_buffs must always exist and start empty.
    """
    pass


def save_node(path: Path, node: dict) -> None:
    """
    Persist a registry node to disk deterministically.
    """
    pass


# ------------------------------------------------------------------------------
# Registry synchronization
# ------------------------------------------------------------------------------

def compute_expected_nodes(
    direct_map: Dict[str, List[str]]
) -> Set[str]:
    """
    Compute the set of node IDs that should exist.

    This may include:
    - all recipe outputs
    - referenced item ingredients
    """
    pass


def update_node_structural_fields(
    node: dict,
    *,
    item_id: str,
    direct_map: Dict[str, List[str]],
    edible: Set[str],
) -> dict:
    """
    Update structural fields on a node.

    This function MUST NOT modify assigned_buffs.
    """
    pass


def sync_registry_nodes(
    *,
    registry_dir: Path,
    expected_nodes: Set[str],
    direct_map: Dict[str, List[str]],
    edible: Set[str],
) -> dict:
    """
    Synchronize registry nodes with expected state.

    - Creates new nodes
    - Updates existing nodes
    - Disables missing nodes
    - Never deletes files
    - Never overwrites assigned_buffs

    Returns stats about the operation.
    """
    pass


# ------------------------------------------------------------------------------
# Generated outputs
# ------------------------------------------------------------------------------

def write_generated_food_list(generated_dir: Path, food_outputs: Set[str]) -> None:
    """Write generated foods.json (edible outputs only)."""
    payload = {
        "food_count": len(food_outputs),
        "food_outputs": sorted(food_outputs),
    }
    write_json(generated_dir / "foods.json", payload)

def write_generated_stats(
    generated_dir: Path,
    stats: dict,
) -> None:
    """
    Write generated statistics for debugging and sanity checks.
    """
    write_json(generated_dir / "stats.json", stats)

# ------------------------------------------------------------------------------
# Logging
# ------------------------------------------------------------------------------

def log(msg: str, *, verbose: bool = False) -> None:
    """
    Emit a log message to stdout.

    Verbose messages may be suppressed based on CLI flags.
    """
    pass


# ------------------------------------------------------------------------------
# Entrypoint
# ------------------------------------------------------------------------------

if __name__ == "__main__":
    raise SystemExit(main())

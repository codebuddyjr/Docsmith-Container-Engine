import os
import json
import subprocess
from pathlib import Path
from flask import Flask, render_template, request, jsonify, Response
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

DOCKSMITH_DIR = Path.home() / ".docksmith"
WORKSPACE_DIR = Path(os.getcwd())

def get_image_manifest_path(name, tag):
    safe_name = name.replace("/", "_").replace(":", "_")
    return DOCKSMITH_DIR / "images" / f"{safe_name}_{tag}.json"

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/images", methods=["GET"])
def list_images():
    images = []
    images_dir = DOCKSMITH_DIR / "images"
    if images_dir.exists():
        for tag_file in images_dir.iterdir():
            if tag_file.is_file() and tag_file.name.endswith(".json"):
                try:
                    with open(tag_file, "r") as f:
                        manifest = json.load(f)
                        images.append({
                            "name": manifest.get("name"),
                            "tag": manifest.get("tag"),
                            "id": manifest.get("digest", "")[:19],
                            "digest": manifest.get("digest", ""),
                            "created": manifest.get("created")
                        })
                except Exception as e:
                    pass
    return jsonify(images)

@app.route("/api/inspect/<name>/<tag>", methods=["GET"])
def inspect_image(name, tag):
    manifest_path = get_image_manifest_path(name, tag)
    if not manifest_path.exists():
        return jsonify({"error": "Image not found"}), 404

    try:
        with open(manifest_path, "r") as f:
            manifest = json.load(f)
        return jsonify(manifest)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/layers/<name>/<tag>", methods=["GET"])
def get_layers(name, tag):
    manifest_path = get_image_manifest_path(name, tag)
    if not manifest_path.exists():
        return jsonify({"error": "Image not found"}), 404

    try:
        with open(manifest_path, "r") as f:
            manifest = json.load(f)

        layers = manifest.get("layers", [])
        total_size = sum(layer.get("size", 0) for layer in layers)

        return jsonify({
            "layers": layers,
            "total_size": total_size
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

def generate_output(process):
    try:
        for line in iter(process.stdout.readline, b''):
            if line:
                yield f"data: {line.decode('utf-8')}\n\n"
        process.stdout.close()
        process.wait()
        yield f"data: [PROCESS_EXIT_CODE] {process.returncode}\n\n"
    except Exception as e:
        yield f"data: [ERROR] {str(e)}\n\n"

@app.route("/api/build", methods=["POST"])
def build_image():
    data = request.json
    tag = data.get("tag")
    context = data.get("context", ".")
    no_cache = data.get("no_cache", False)

    if not tag:
        return jsonify({"error": "Tag is required"}), 400

    cmd = ["python", "-m", "docksmith.main", "build", "-t", tag]
    if no_cache:
        cmd.append("--no-cache")
    cmd.append(context)

    cwd = str(WORKSPACE_DIR.parent) if WORKSPACE_DIR.name == "docksmith_gui" else str(WORKSPACE_DIR)
    print(f"Executing command: {' '.join(cmd)} in cwd: {cwd}")

    process = subprocess.Popen(
        cmd,
        cwd=cwd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        bufsize=1
    )

    return Response(generate_output(process), mimetype='text/event-stream')

@app.route("/api/run", methods=["POST"])
def run_image():
    data = request.json
    image = data.get("image")
    cmd_override = data.get("command", "")
    env_vars = data.get("env", [])

    if not image:
        return jsonify({"error": "Image is required"}), 400

    cmd = ["python", "-m", "docksmith.main", "run"]
    for env in env_vars:
        if env.strip():
            cmd.extend(["-e", env.strip()])
    cmd.append(image)
    if cmd_override.strip():
        # Split command rudimentarily. A better approach might use shlex
        cmd.extend(cmd_override.strip().split())

    cwd = WORKSPACE_DIR.parent if WORKSPACE_DIR.name == "docksmith_gui" else WORKSPACE_DIR

    process = subprocess.Popen(
        cmd,
        cwd=cwd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        bufsize=1
    )

    return Response(generate_output(process), mimetype='text/event-stream')

@app.route("/api/isolation", methods=["POST"])
def isolation_test():
    data = request.json
    image = data.get("image")
    if not image:
        return jsonify({"error": "Image is required"}), 400

    # The isolation test command: write a file to the container's root
    test_filepath = "/HACKED_HOST_FILE.txt"
    test_cmd = ["/bin/sh", "-c", f"echo 'hacked' > {test_filepath}"]

    cmd = ["python", "-m", "docksmith.main", "run", image] + test_cmd

    cwd = WORKSPACE_DIR.parent if WORKSPACE_DIR.name == "docksmith_gui" else WORKSPACE_DIR

    process = subprocess.Popen(
        cmd,
        cwd=cwd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT
    )

    stdout, _ = process.communicate()
    exit_code = process.returncode

    # Check if file exists on host
    host_file_path = Path(cwd) / test_filepath.lstrip("/")
    # Also check actual absolute path just to be safe
    absolute_host_path = Path("C:") / test_filepath.lstrip("/") if os.name == "nt" else Path(test_filepath)

    file_exists_on_host = host_file_path.exists() or absolute_host_path.exists()

    return jsonify({
        "exit_code": exit_code,
        "output": stdout.decode("utf-8"),
        "file_exists_on_host": file_exists_on_host,
        "isolation_successful": not file_exists_on_host
    })

@app.route("/api/rmi/<name>/<tag>", methods=["DELETE"])
def remove_image(name, tag):
    cmd = ["python", "-m", "docksmith.main", "rmi", f"{name}:{tag}"]
    cwd = WORKSPACE_DIR.parent if WORKSPACE_DIR.name == "docksmith_gui" else WORKSPACE_DIR

    process = subprocess.Popen(
        cmd,
        cwd=cwd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT
    )

    stdout, _ = process.communicate()

    if process.returncode == 0:
        return jsonify({"success": True, "output": stdout.decode("utf-8")})
    else:
        return jsonify({"success": False, "error": stdout.decode("utf-8")}), 500

if __name__ == "__main__":
    app.run(debug=True, port=5000)

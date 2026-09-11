import hashlib, json, os, pathlib, subprocess
SOURCE = "9ac82bdafde6a5e612bad59248ec08e64b09826c"
RELEASE = "387069349"
TAG = "v2.1.0-beta.2"
ASSET_RUN = os.environ["ASSET_RUN"]
VARIANTS = {
 "universal": "universal.dmg",
 "macos11-universal": "macos11-universal.dmg",
 "macos1015-x64": "macos1015-x64.dmg",
 "windows-x64": "x64.exe",
}
def api(endpoint):
 return json.loads(subprocess.check_output(["gh", "api", "repos/QortiumDev/qortium-home/" + endpoint], text=True))
def check_draft():
 release = api("releases/" + RELEASE)
 assert release["draft"] and release["prerelease"]
 assert release["tag_name"] == TAG and release["target_commitish"] == SOURCE
 return release
check_draft()
assert api("git/ref/tags/" + TAG)["object"]["sha"] == SOURCE
run = api("actions/runs/" + ASSET_RUN)
assert run["conclusion"] == "success" and run["head_branch"] == "release/home-beta2-native-assets"
for variant, suffix in VARIANTS.items():
 directory = pathlib.Path("downloaded") / variant
 subprocess.run(["gh", "run", "download", ASSET_RUN, "--name", "home-beta2-" + variant, "--dir", str(directory)], check=True)
 assert (directory / "SOURCE_COMMIT").read_text(encoding="utf-8-sig").strip() == SOURCE
 asset = directory / ("Qortium-Home-2.1.0-beta.2-" + suffix)
 digest = hashlib.sha256(asset.read_bytes()).hexdigest()
 recorded = (directory / "SHA256SUMS").read_text(encoding="utf-8-sig").split()[0].lower()
 assert recorded == digest, (variant, recorded, digest)
 release = check_draft()
 assert asset.name not in [x["name"] for x in release["assets"]]
 subprocess.run(["gh", "release", "upload", TAG, str(asset)], check=True)
 uploaded = next(x for x in check_draft()["assets"] if x["name"] == asset.name)
 assert uploaded["size"] == asset.stat().st_size
 assert uploaded["digest"] == "sha256:" + digest
 print(json.dumps({"name": asset.name, "size": asset.stat().st_size, "sha256": digest, "source": SOURCE}), flush=True)

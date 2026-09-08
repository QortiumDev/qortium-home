import hashlib, json, pathlib, subprocess
SOURCE = "0fa4b428c880d7163aa944e918643da53f4cb5b7"
RELEASE = "384418958"
EXPECTED = {
 "universal": ("universal.dmg", "ef42a7d154634dc32bdd2ab399b6bf37d26bf0639f5992460883c432b762cdf8"),
 "macos11-universal": ("macos11-universal.dmg", "4a3c4fdf1cfb94e3456d194c4c7d6438ce42a609b7d96e1ebadfe0c90ad41b61"),
 "macos1015-x64": ("macos1015-x64.dmg", "b116265361cb30edcd163c590545732fda0d878ac73801eb6ab558e312c81a81"),
 "windows-x64": ("x64.exe", "d51a84290da24222055e731ec24226b3b719405772daef6dd43613a9f45b3730"),
}
def api(endpoint):
 return json.loads(subprocess.check_output(["gh", "api", "repos/QortiumDev/qortium-home/" + endpoint], text=True))
def check_draft():
 release = api("releases/" + RELEASE)
 assert release["draft"] and release["prerelease"]
 assert release["tag_name"] == "v2.1.0-beta.1" and release["target_commitish"] == SOURCE
 return release
check_draft()
for variant, (suffix, expected) in EXPECTED.items():
 directory = pathlib.Path("downloaded") / variant
 subprocess.run(["gh", "run", "download", "34180879027", "--name", "home-beta1-" + variant, "--dir", str(directory)], check=True)
 assert (directory / "SOURCE_COMMIT").read_text(encoding="utf-8-sig").strip() == SOURCE
 asset = directory / ("Qortium-Home-2.1.0-beta.1-" + suffix)
 digest = hashlib.sha256(asset.read_bytes()).hexdigest()
 assert digest == expected
 assert (directory / "SHA256SUMS").read_text(encoding="utf-8-sig").split()[0].lower() == expected
 release = check_draft()
 assert asset.name not in [x["name"] for x in release["assets"]]
 subprocess.run(["gh", "release", "upload", "v2.1.0-beta.1", str(asset)], check=True)
 uploaded = next(x for x in check_draft()["assets"] if x["name"] == asset.name)
 assert uploaded["size"] == asset.stat().st_size
 assert uploaded["digest"] == "sha256:" + digest
 print(json.dumps({"name": asset.name, "size": asset.stat().st_size, "sha256": digest, "source": SOURCE}), flush=True)

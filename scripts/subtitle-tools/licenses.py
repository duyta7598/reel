from pathlib import Path
import importlib.metadata
import imageio_ffmpeg
import shutil
import subprocess
import sys
import sysconfig

project = Path(__file__).resolve().parents[2]
tools = project / "Vendor/SubtitleTools"
ffmpeg = tools / ("ffmpeg.exe" if sys.platform == "win32" else "ffmpeg")
shutil.copy2(imageio_ffmpeg.get_ffmpeg_exe(), ffmpeg)
licenses = tools / "Licenses"
licenses.mkdir(exist_ok=True)
for distribution in importlib.metadata.distributions():
    for item in distribution.files or []:
        if "license" in str(item).lower() or item.name.lower().startswith("copying"):
            source = Path(distribution.locate_file(item))
            if source.is_file():
                destination = licenses / distribution.metadata["Name"] / str(item).replace("../", "")
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, destination)
with (licenses / "FFMPEG-LICENSE.txt").open("w") as handle:
    subprocess.run([str(ffmpeg), "-L"], stdout=handle, stderr=handle, check=True)
(licenses / "SOURCES.txt").write_text("ffsubsync 0.5.1: https://github.com/smacke/ffsubsync\nFFmpeg 7.1: https://ffmpeg.org/releases/ffmpeg-7.1.tar.xz\nBinary supplied by imageio-ffmpeg 0.6.0: https://github.com/imageio/imageio-ffmpeg\nFFmpeg build configuration: see FFMPEG-LICENSE.txt\nPython runtime: https://www.python.org/\nPyInstaller bootloader: https://github.com/pyinstaller/pyinstaller (GPL with bootloader exception)\n")

python_license = Path(sysconfig.get_path("stdlib")) / "LICENSE.txt"
if python_license.exists():
    shutil.copy2(python_license, licenses / "PYTHON-LICENSE.txt")

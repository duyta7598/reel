import importlib.metadata
from pathlib import Path
import shutil
import subprocess
import sys

project = Path(__file__).resolve().parents[2]
script = Path(__file__).resolve().parent
env = project / "build/subtitle-tools-env"
python = env / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")
if not python.exists():
    subprocess.run([sys.executable, "-m", "venv", str(env)], check=True)
subprocess.run([str(python), "-m", "pip", "install", "-r", str(script / "requirements.txt")], check=True)
subprocess.run([str(python), "-m", "PyInstaller", "--noconfirm", "--clean", "--onedir", "--name", "reel-subtitle-align", "--additional-hooks-dir", str(script / "hooks"), "--distpath", str(project / "Vendor/SubtitleTools"), "--workpath", str(project / "build/subtitle-pyinstaller"), "--specpath", str(project / "build"), "--collect-all", "ffsubsync", str(script / "align.py")], check=True)
subprocess.run([str(python), str(script / "licenses.py")], check=True)

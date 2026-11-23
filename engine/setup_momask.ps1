# Installs the DEFAULT text-to-motion backend (MoMask) into engine\.venv-motion. No account or token needed.
# ~3 GB PyTorch + ~1.4 GB Motius source (git clone) + ~550 MB weights (downloaded on first use from Hugging Face).
#
# LICENSE NOTE: the Motius repo declares no license, and MoMask weights (trained on HumanML3D, derived from AMASS) are
# "license: other" / research terms. Treat generated motion as research/personal-use only until you have checked them.
$ErrorActionPreference = "Stop"
$engine = $PSScriptRoot
$venv = Join-Path $engine ".venv-motion"
if (-not (Test-Path $venv)) { python -m venv $venv }
$py = Join-Path $venv "Scripts\python.exe"
& $py -m pip install --upgrade pip
& $py -m pip install torch --index-url https://download.pytorch.org/whl/cu128
& $py -m pip install "numpy<2.4" scipy safetensors "transformers>=4.30,<5" huggingface_hub accelerate "diffusers>=0.20" peft datasets mmengine einops
$src = Join-Path $engine "third_party\Motius"
if (-not (Test-Path $src)) { git clone --depth 1 https://github.com/ZeyuLing/Motius.git $src }
Write-Host "Done. Test:  $py $engine\motion_backends\momask_run.py `"a person waves`" 80 out.npy"

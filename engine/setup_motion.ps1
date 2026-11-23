# Installs the OPTIONAL text-to-motion backend (NVIDIA Kimodo) into engine\.venv-motion.
# Not run automatically: it downloads several GB and needs your Hugging Face access (see below).
# Requirements: NVIDIA GPU + driver, internet, ~10 GB disk (+ ~16 GB when the Llama-3 text encoder first downloads).
#
# IMPORTANT (licenses):
#  * Kimodo code: Apache-2.0. Kimodo-SOMA-RP checkpoints: NVIDIA Open Model License.
#    Do NOT use the SMPL-X checkpoint (NVIDIA R&D license only).
#  * Its text encoder is meta-llama/Meta-Llama-3-8B-Instruct, a GATED model (Meta Llama 3 Community License).
#    Request access at https://huggingface.co/meta-llama/Meta-Llama-3-8B-Instruct, then run `hf auth login`.
$ErrorActionPreference = "Stop"
$engine = $PSScriptRoot
$venv = Join-Path $engine ".venv-motion"
if (-not (Test-Path $venv)) { python -m venv $venv }
$py = Join-Path $venv "Scripts\python.exe"
& $py -m pip install --upgrade pip
& $py -m pip install torch --index-url https://download.pytorch.org/whl/cu128
& $py -m pip install "git+https://github.com/nv-tlabs/kimodo.git"
& $py -m pip install huggingface_hub
Write-Host ""
Write-Host "Next: get access to meta-llama/Meta-Llama-3-8B-Instruct, then log in:"
Write-Host "  $py -m huggingface_hub.commands.huggingface_cli login"
Write-Host "AutoBones sets TEXT_ENCODER_DEVICE=cpu so the 17GB text encoder does not need GPU VRAM (RTX 3060 12GB is fine)."

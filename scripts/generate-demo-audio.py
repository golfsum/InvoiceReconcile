"""Generate the two homepage narration tracks with Kokoro-82M.

Install `kokoro-onnx` and `soundfile`, then provide the official Kokoro v1.0
ONNX model and voice bundle paths. The script writes WAV masters; the release
workflow converts them to MP3 for browser delivery.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import soundfile as sf
from kokoro_onnx import Kokoro


SCRIPTS = {
    "combined-payment-demo.wav": (
        "ABC Consulting sent four thousand seven hundred twenty five dollars in one ACH deposit. "
        "Northstar has three open invoices for fifteen hundred, twelve twenty five, and two thousand dollars. "
        "Those invoices total exactly four thousand seven hundred twenty five. "
        "The payer name and invoice timing also agree, so InvoiceReconcile proposes one combined match. "
        "Nothing posts automatically. The bookkeeper can inspect the evidence and confirm the application."
    ),
    "fee-difference-demo.wav": (
        "Bluebird Studio owes five thousand dollars, but the deposit is four thousand eight hundred fifty. "
        "The system does not silently call the difference a processing fee. "
        "It marks a one hundred fifty dollar discrepancy, explains the amount, and sends it to review. "
        "The bookkeeper can record a fee, choose another invoice, or leave the payment unmatched."
    ),
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--voices", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--voice", default="af_heart")
    parser.add_argument("--speed", type=float, default=0.96)
    args = parser.parse_args()

    args.output_dir.mkdir(parents=True, exist_ok=True)
    kokoro = Kokoro(str(args.model), str(args.voices))
    for filename, script in SCRIPTS.items():
        samples, sample_rate = kokoro.create(
            script,
            voice=args.voice,
            speed=args.speed,
            lang="en-us",
        )
        sf.write(args.output_dir / filename, samples, sample_rate)


if __name__ == "__main__":
    main()

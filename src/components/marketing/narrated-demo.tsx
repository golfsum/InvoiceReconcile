"use client";

import { AlertTriangle, Check, Pause, Play, RotateCcw, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { sendAnalyticsEvent } from "@/components/analytics/analytics-provider";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import { sendVercelAnalyticsEvent } from "@/lib/analytics/client";

const scenarios = {
  combined: {
    label: "Combined payment",
    payer: "ABC Consulting",
    payment: "$4,725.00",
    memo: "ACH ABC CONSULTING APRIL",
    invoices: [
      { id: "INV-10487", amount: "$1,500.00" },
      { id: "INV-10491", amount: "$1,225.00" },
      { id: "INV-10503", amount: "$2,000.00" },
    ],
    result: "3 invoices matched",
    resultDetail: "$4,725.00 applied, $0.00 remaining",
    narration:
      "ABC Consulting sent four thousand seven hundred twenty five dollars in one ACH deposit. Northstar has three open invoices for fifteen hundred, twelve twenty five, and two thousand dollars. Those invoices total exactly four thousand seven hundred twenty five. The payer name and invoice timing also agree, so InvoiceReconcile proposes one combined match. Nothing posts automatically. The bookkeeper can inspect the evidence and confirm the application.",
    captions: [
      "One ACH deposit arrives from ABC Consulting.",
      "Three open invoices total the same $4,725.00.",
      "Amount, payer, and timing support one combined match.",
      "The match is proposed for review. Nothing posts automatically.",
    ],
    audio: "/audio/combined-payment-demo.mp3",
    status: "exact" as const,
  },
  fee: {
    label: "Fee difference",
    payer: "Bluebird Studio",
    payment: "$4,850.00",
    memo: "CARD SETTLEMENT BLUEBIRD",
    invoices: [{ id: "INV-10516", amount: "$5,000.00" }],
    result: "Review $150.00 difference",
    resultDetail: "Possible deduction or processing fee",
    narration:
      "Bluebird Studio owes five thousand dollars, but the deposit is four thousand eight hundred fifty. The system does not silently call the difference a processing fee. It marks a one hundred fifty dollar discrepancy, explains the amount, and sends it to review. The bookkeeper can record a fee, choose another invoice, or leave the payment unmatched.",
    captions: [
      "A $4,850.00 deposit arrives against a $5,000.00 invoice.",
      "The amount is short by $150.00.",
      "InvoiceReconcile does not assume the reason for the difference.",
      "The discrepancy stays in review until a person decides.",
    ],
    audio: "/audio/fee-difference-demo.mp3",
    status: "review" as const,
  },
};

type ScenarioKey = keyof typeof scenarios;

function chooseVoice(voices: SpeechSynthesisVoice[]) {
  const english = voices.filter((voice) => voice.lang.toLowerCase().startsWith("en"));
  return (
    english.find((voice) => /natural|online|neural/i.test(voice.name)) ||
    english.find((voice) => /google|microsoft|samantha|ava/i.test(voice.name)) ||
    english[0] ||
    voices[0]
  );
}

export function NarratedDemo() {
  const [scenarioKey, setScenarioKey] = useState<ScenarioKey>("combined");
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [step, setStep] = useState(0);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const timers = useRef<number[]>([]);
  const scenario = scenarios[scenarioKey];

  function clearPlayback() {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current = [];
    audioRef.current?.pause();
    window.speechSynthesis?.cancel();
    setPlaying(false);
  }

  useEffect(() => () => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    window.speechSynthesis?.cancel();
  }, []);

  useEffect(() => {
    if (audioRef.current) audioRef.current.muted = muted;
  }, [muted]);

  async function play() {
    clearPlayback();
    setPlaying(true);
    setStep(0);
    setConfirmed(false);
    sendVercelAnalyticsEvent("sample_demo_started", { scenario: scenarioKey });
    sendAnalyticsEvent("sample_demo_started", { demo_scenario: scenarioKey === "combined" ? "combined_payment" : "fee_difference" });

    const audio = audioRef.current;
    if (audio) {
      audio.currentTime = 0;
      audio.muted = muted;
      try {
        await audio.play();
        return;
      } catch {
        // Fall through to the browser voice only if media playback is unavailable.
      }
    }

    const duration = scenarioKey === "combined" ? 31_000 : 21_000;
    scenario.captions.forEach((_, index) => timers.current.push(window.setTimeout(() => setStep(index), index * (duration / 4))));
    timers.current.push(window.setTimeout(() => setPlaying(false), duration));
    if (!muted && "speechSynthesis" in window) {
      const utterance = new SpeechSynthesisUtterance(scenario.narration);
      utterance.rate = 0.96;
      utterance.pitch = 1;
      const voice = chooseVoice(window.speechSynthesis.getVoices());
      if (voice) utterance.voice = voice;
      utterance.onend = () => setPlaying(false);
      utterance.onerror = () => setPlaying(false);
      window.speechSynthesis.speak(utterance);
    }
  }

  function switchScenario(next: ScenarioKey) {
    clearPlayback();
    setScenarioKey(next);
    setStep(0);
    setEvidenceOpen(false);
    setConfirmed(false);
  }

  function confirmDecision() {
    clearPlayback();
    setStep(3);
    setConfirmed(true);
    sendVercelAnalyticsEvent("sample_demo_decision", { scenario: scenarioKey, decision: scenario.status === "exact" ? "confirmed" : "review" });
    sendAnalyticsEvent("exception_reviewed", { result: scenario.status === "exact" ? "confirmed" : "completed", match_method: scenario.status === "exact" ? "combined_payment" : "fee_difference" });
  }

  return (
    <section id="demo" aria-labelledby="demo-title" className="border-y bg-[#122d24] py-16 text-white sm:py-20">
      <div className="page-shell">
        <div className="grid gap-8 lg:grid-cols-[0.72fr_1.28fr] lg:items-end">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#8dd9b5]">Interactive walkthrough</p>
            <h2 id="demo-title" className="mt-4 max-w-xl text-balance text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
              Watch the matching logic, then inspect the evidence.
            </h2>
            <p className="mt-4 max-w-lg text-base leading-7 text-[#c6d8d0]">
              The narration follows a representative reconciliation decision. Use the scenario buttons to see how exact and uncertain cases are handled differently.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 lg:justify-end" role="tablist" aria-label="Demo scenario">
            {(Object.keys(scenarios) as ScenarioKey[]).map((key) => (
              <button
                type="button"
                role="tab"
                aria-selected={scenarioKey === key}
                key={key}
                onClick={() => switchScenario(key)}
                className={cn(
                  "border px-4 py-2 text-sm font-semibold transition",
                  scenarioKey === key ? "border-white bg-white text-[#14281f]" : "border-white/25 text-white hover:border-white/60",
                )}
              >
                {scenarios[key].label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-9 overflow-hidden border border-white/15 bg-[#f8faf8] text-[#17201d] shadow-2xl shadow-black/20">
          <div className="flex flex-col gap-3 border-b border-[#d7ddd9] bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div className="flex items-center gap-3">
              <span className="size-2 bg-[#17714e]" aria-hidden="true" />
              <span className="text-sm font-semibold">Northstar Services</span>
              <span className="text-xs text-[#66736d]">April reconciliation</span>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => setMuted((value) => !value)} aria-label={muted ? "Enable narration" : "Mute narration"}>
                {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
                {muted ? "Narration off" : "Narration on"}
              </Button>
              <Button size="sm" onClick={playing ? clearPlayback : () => void play()}>
                {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
                {playing ? "Pause" : step > 0 ? "Replay" : "Play walkthrough"}
              </Button>
              {step > 0 && !playing ? (
                <button type="button" className="inline-flex size-8 items-center justify-center text-[#5b6862]" onClick={() => setStep(0)} aria-label="Reset demo">
                  <RotateCcw className="size-4" />
                </button>
              ) : null}
            </div>
          </div>
          <audio
            key={scenario.audio}
            ref={audioRef}
            preload="metadata"
            src={scenario.audio}
            muted={muted}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => { setPlaying(false); setStep(3); }}
            onTimeUpdate={(event) => {
              const audio = event.currentTarget;
              if (Number.isFinite(audio.duration) && audio.duration > 0) setStep(Math.min(3, Math.floor((audio.currentTime / audio.duration) * 4)));
            }}
          />

          <div className="grid lg:grid-cols-[0.9fr_1.1fr]">
            <div className="border-b border-[#d7ddd9] p-5 sm:p-7 lg:border-r lg:border-b-0">
              <p className="text-xs font-bold uppercase tracking-[0.1em] text-[#69766f]">Incoming payment</p>
              <div className="mt-5 flex items-start justify-between gap-4">
                <div>
                  <h3 className="font-semibold">{scenario.payer}</h3>
                  <p className="mt-1 font-mono text-xs text-[#65716b]">{scenario.memo}</p>
                </div>
                <p className="numeric text-xl font-semibold">{scenario.payment}</p>
              </div>
              <dl className="mt-7 grid grid-cols-2 gap-x-5 gap-y-4 border-t border-[#d7ddd9] pt-5 text-sm">
                <div>
                  <dt className="text-[#65716b]">Received</dt>
                  <dd className="mt-1 font-medium">Apr 12, 2026</dd>
                </div>
                <div>
                  <dt className="text-[#65716b]">Bank reference</dt>
                  <dd className="mt-1 font-mono text-xs font-medium">ACH-884209</dd>
                </div>
              </dl>
            </div>

            <div className="p-5 sm:p-7">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-bold uppercase tracking-[0.1em] text-[#69766f]">Suggested invoices</p>
                <StatusBadge status={scenario.status} label={scenario.status === "exact" ? "Exact" : "Review"} />
              </div>
              <div className="mt-4 divide-y border-y border-[#d7ddd9]">
                {scenario.invoices.map((invoice, index) => (
                  <div key={invoice.id} className={cn("flex items-center justify-between py-3 transition", step >= 1 ? "opacity-100" : "opacity-65")}>
                    <div className="flex items-center gap-3">
                      <span className={cn("inline-flex size-5 items-center justify-center border text-[10px]", step >= 2 ? "border-[#16734f] bg-[#e6f4ed] text-[#16734f]" : "border-[#bcc5bf]") }>
                        {step >= 2 ? <Check className="size-3" /> : index + 1}
                      </span>
                      <span className="font-mono text-xs font-semibold">{invoice.id}</span>
                    </div>
                    <span className="numeric text-sm font-semibold">{invoice.amount}</span>
                  </div>
                ))}
              </div>
              <div className={cn("mt-5 border-l-4 p-4 transition", scenario.status === "exact" ? "border-[#16734f] bg-[#e9f5ef]" : "border-[#a46216] bg-[#fff3dc]")}>
                <div className="flex gap-3">
                  {scenario.status === "exact" ? <Check className="mt-0.5 size-5 text-[#16734f]" /> : <AlertTriangle className="mt-0.5 size-5 text-[#9a5b12]" />}
                  <div>
                    <p className="font-semibold">{scenario.result}</p>
                    <p className="mt-1 text-sm text-[#54625b]">{scenario.resultDetail}</p>
                  </div>
                </div>
              </div>
              {evidenceOpen ? (
                <dl className="mt-4 grid gap-3 border bg-white p-4 text-xs sm:grid-cols-3">
                  <div><dt className="text-[#65716b]">Amount evidence</dt><dd className="mt-1 font-semibold">{scenario.status === "exact" ? "Exact total" : "$150 difference"}</dd></div>
                  <div><dt className="text-[#65716b]">Payer evidence</dt><dd className="mt-1 font-semibold">Normalized name agrees</dd></div>
                  <div><dt className="text-[#65716b]">Date evidence</dt><dd className="mt-1 font-semibold">Within configured window</dd></div>
                </dl>
              ) : null}
            </div>
          </div>

          <div className="grid border-t border-[#d7ddd9] bg-white sm:grid-cols-[1fr_auto]">
            <div className="min-h-20 px-5 py-4 sm:px-7" aria-live="polite">
              <p className="text-xs font-bold uppercase tracking-[0.1em] text-[#69766f]">Narration</p>
              <p className="mt-1.5 text-sm leading-6 text-[#33423b]">{scenario.captions[step]}</p>
            </div>
            <div className="flex items-center gap-2 border-t border-[#d7ddd9] px-5 py-4 sm:border-t-0 sm:border-l sm:px-7">
              <button type="button" aria-expanded={evidenceOpen} onClick={() => setEvidenceOpen((value) => !value)} className="min-h-9 border border-[#b8c2bc] px-3 text-sm font-semibold hover:bg-[#f2f4f2]">{evidenceOpen ? "Hide evidence" : "Inspect evidence"}</button>
              <button type="button" disabled={confirmed} onClick={confirmDecision} className="min-h-9 bg-[#176b4d] px-3 text-sm font-semibold text-white hover:bg-[#10583f] disabled:cursor-default disabled:bg-[#47665a]">{confirmed ? (scenario.status === "exact" ? "Confirmed for export" : "Left in review") : (scenario.status === "exact" ? "Confirm match" : "Keep in review")}</button>
            </div>
          </div>
        </div>
        <p className="mt-4 text-xs text-[#a9c0b5]">
          Fictional Northstar Services data. Narrated with a bundled neural voice and synchronized captions.
        </p>
      </div>
    </section>
  );
}

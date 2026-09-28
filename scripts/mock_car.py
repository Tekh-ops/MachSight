#!/usr/bin/env python3
"""mock_car.py — RC car telemetry simulator for MachSight.

Streams physically-plausible JSON readings to the backend WebSocket at a
configurable rate.  The car starts healthy and, after --start-fault-after
seconds, transitions to the requested fault mode.

Fault signatures (calibrated against reference.pkl forward:200 baseline):
  healthy       current ~1.75 A, rpm ~303 RPM  (Gaussian noise)
  drag          sustained current up (+40–80%), rpm down (−20–35%),
                current/RPM ratio 30–100%+ above baseline
  jam           sudden stall: current spikes to 5–7 A, rpm collapses < 10,
                distance remains clear (> 40 cm, internal jam not a wall)
  sensor_fault  distance sensor freezes at a single value while car moves,
                or emits out-of-range values (< 2 cm or > 400 cm)

Usage:
  python scripts/mock_car.py [OPTIONS]

Options:
  --fault         none | drag | jam | sensor_fault   (default: none)
  --duration      total run duration in seconds       (default: 30)
  --rate          readings per second                 (default: 10)
  --start-fault-after  seconds of healthy data first  (default: 5)
  --host          backend host                        (default: localhost)
  --port          backend port                        (default: 8000)
  --car-id        vehicle identifier                  (default: car-01)
  --pwm           PWM command value (0-255)           (default: 200)
  --mode          operating mode                      (default: forward)
  --verbose       print each reading to stdout
"""

import argparse
import asyncio
import json
import math
import random
import sys
import time

try:
    import websockets
except ImportError:
    print("ERROR: 'websockets' not installed.  Run: pip install websockets")
    sys.exit(1)

# ---------------------------------------------------------------------------
# Reference baseline (forward:200 bucket) — keep in sync with reference.pkl
# ---------------------------------------------------------------------------
BASELINES = {
    ("idle", 0):            {"current_mean": 0.119, "current_std": 0.011, "rpm_mean": 0.0,   "rpm_std": 0.0},
    ("forward", 100):       {"current_mean": 0.859, "current_std": 0.035, "rpm_mean": 123.8, "rpm_std": 4.3},
    ("forward", 150):       {"current_mean": 1.252, "current_std": 0.059, "rpm_mean": 210.0, "rpm_std": 5.9},
    ("forward", 200):       {"current_mean": 1.753, "current_std": 0.075, "rpm_mean": 303.2, "rpm_std": 8.6},
    ("turning_left", 100):  {"current_mean": 1.052, "current_std": 0.046, "rpm_mean": 104.4, "rpm_std": 5.1},
    ("turning_left", 150):  {"current_mean": 1.507, "current_std": 0.063, "rpm_mean": 181.8, "rpm_std": 6.6},
    ("turning_left", 200):  {"current_mean": 2.106, "current_std": 0.091, "rpm_mean": 266.7, "rpm_std": 9.2},
    ("turning_right", 100): {"current_mean": 1.054, "current_std": 0.053, "rpm_mean": 105.0, "rpm_std": 4.7},
    ("turning_right", 150): {"current_mean": 1.516, "current_std": 0.058, "rpm_mean": 179.1, "rpm_std": 7.3},
    ("turning_right", 200): {"current_mean": 2.133, "current_std": 0.096, "rpm_mean": 265.9, "rpm_std": 8.6},
    ("braking", 0):         {"current_mean": 0.652, "current_std": 0.074, "rpm_mean": 14.8,  "rpm_std": 4.9},
    ("braking", 50):        {"current_mean": 1.378, "current_std": 0.089, "rpm_mean": 39.7,  "rpm_std": 7.6},
}

def _nearest_baseline(mode: str, pwm: int) -> dict:
    """Return baseline stats for the (mode, pwm) bucket or nearest match."""
    key = (mode, pwm)
    if key in BASELINES:
        return BASELINES[key]
    # Nearest PWM for the given mode
    mode_keys = [(m, p) for (m, p) in BASELINES if m == mode]
    if not mode_keys:
        # Fallback to forward:200
        return BASELINES[("forward", 200)]
    nearest = min(mode_keys, key=lambda k: abs(k[1] - pwm))
    return BASELINES[nearest]


def _healthy_reading(mode: str, pwm: int, distance_base: float, rng: random.Random) -> dict:
    """Generate a Gaussian-noised healthy reading around the bucket baseline."""
    bl = _nearest_baseline(mode, pwm)
    z_curr = max(-2.0, min(2.0, rng.gauss(0, 1)))
    z_rpm = max(-2.0, min(2.0, rng.gauss(0, 1)))
    current = max(0.0, bl["current_mean"] + z_curr * bl["current_std"])
    rpm_std = max(bl["rpm_std"], 1.0) if bl["rpm_mean"] > 0 else 0.1
    rpm = max(0.0, bl["rpm_mean"] + z_rpm * rpm_std)
    # Slowly drift the distance to simulate vehicle movement
    distance = max(5.0, min(380.0, distance_base + rng.gauss(0, 1.5)))
    return {"current_a": round(current, 4), "rpm": round(rpm, 2), "distance_cm": round(distance, 2)}


class MockCar:
    """Stateful fault-mode RC car simulator."""

    def __init__(self, mode: str, pwm: int, fault: str, start_fault_after: float, rng: random.Random):
        self.mode = mode
        self.pwm = pwm
        self.fault = fault
        self.start_fault_after = start_fault_after
        self.rng = rng
        self.start_time = time.time()
        self._distance_base = rng.uniform(40.0, 120.0)  # starting environment distance
        self._frozen_distance: float | None = None       # for sensor_fault
        self._drag_ramp = 0.0                            # 0→1 over first few drag samples
        self._jam_triggered = False
        self._jam_distance: float | None = None

    def _in_fault_phase(self) -> bool:
        return (time.time() - self.start_time) >= self.start_fault_after

    def next_reading(self) -> dict:
        """Generate the next telemetry sample given current state."""
        if not self._in_fault_phase() or self.fault == "none":
            return self._gen_healthy()

        if self.fault == "drag":
            return self._gen_drag()
        elif self.fault == "jam":
            return self._gen_jam()
        elif self.fault == "sensor_fault":
            return self._gen_sensor_fault()
        else:
            return self._gen_healthy()

    # ------------------------------------------------------------------
    # Healthy
    # ------------------------------------------------------------------
    def _gen_healthy(self) -> dict:
        base = _healthy_reading(self.mode, self.pwm, self._distance_base, self.rng)
        # Slowly drift distance
        self._distance_base += self.rng.gauss(0, 0.5)
        self._distance_base = max(10.0, min(350.0, self._distance_base))
        return base

    # ------------------------------------------------------------------
    # Drag: sustained current up, RPM down, ratio elevated 40–80%
    # baseline (forward:200): current ~1.75A, rpm ~303
    # Drag target: current ~2.6A (+48%), rpm ~210 (−30%)
    # ------------------------------------------------------------------
    def _gen_drag(self) -> dict:
        self._drag_ramp = min(1.0, self._drag_ramp + 0.10)
        r = self._drag_ramp
        bl = _nearest_baseline(self.mode, self.pwm)

        current_target = bl["current_mean"] * (1.0 + r * 0.55)   # +55% at full ramp
        rpm_target     = bl["rpm_mean"]     * (1.0 - r * 0.32)   # −32% at full ramp

        current = max(0.0, self.rng.gauss(current_target, bl["current_std"] * 1.5))
        rpm     = max(5.0, self.rng.gauss(rpm_target,     bl["rpm_std"]     * 1.5))

        # Drag scenario: path is unobstructed
        self._distance_base += self.rng.gauss(0, 0.5)
        self._distance_base = max(20.0, min(350.0, self._distance_base))
        distance = max(5.0, self._distance_base + self.rng.gauss(0, 1.0))

        return {
            "current_a":   round(current, 4),
            "rpm":         round(rpm, 2),
            "distance_cm": round(distance, 2),
        }

    # ------------------------------------------------------------------
    # Jam: sudden stall — current spikes 5–7 A, rpm collapses to < 10,
    # distance stays clear (no wall contact, internal jam)
    # ------------------------------------------------------------------
    def _gen_jam(self) -> dict:
        if not self._jam_triggered:
            self._jam_triggered = True
            # Freeze the distance at whatever it was so it stays clear (> 40 cm)
            self._jam_distance = max(45.0, self._distance_base + self.rng.uniform(5.0, 30.0))

        # Stall current: 5 – 7 A with a small jitter
        current = self.rng.uniform(5.0, 7.0) + self.rng.gauss(0, 0.15)
        # Wheel locked or nearly locked
        rpm = max(0.0, self.rng.gauss(5.0, 3.0))
        # Distance stays clear
        distance = self._jam_distance + self.rng.gauss(0, 0.8)  # type: ignore[operator]
        distance = max(2.5, min(399.0, distance))

        return {
            "current_a":   round(current, 4),
            "rpm":         round(rpm, 2),
            "distance_cm": round(distance, 2),
        }

    # ------------------------------------------------------------------
    # Sensor fault: distance sensor freezes or emits out-of-range values
    # Current / RPM remain healthy (fault is sensor-only, not motor)
    # ------------------------------------------------------------------
    def _gen_sensor_fault(self) -> dict:
        # Motor is fine
        bl = _nearest_baseline(self.mode, self.pwm)
        current = max(0.0, self.rng.gauss(bl["current_mean"], bl["current_std"]))
        rpm_std = max(bl["rpm_std"], 1.0)
        rpm     = max(0.0, self.rng.gauss(bl["rpm_mean"], rpm_std))

        # 50/50: frozen distance or out-of-range value
        if self._frozen_distance is None:
            choice = self.rng.choice(["frozen", "out_of_range"])
            if choice == "frozen":
                self._frozen_distance = self.rng.uniform(20.0, 150.0)
            else:
                self._frozen_distance = -1.0   # sentinel for out-of-range

        if self._frozen_distance < 0:
            # Out-of-range: alternate between < 2 cm and > 400 cm
            distance = self.rng.choice([
                self.rng.uniform(0.0, 1.5),    # below minimum
                self.rng.uniform(401.0, 500.0) # above maximum
            ])
        else:
            # Perfectly frozen — exactly the same value every tick
            distance = self._frozen_distance

        return {
            "current_a":   round(current, 4),
            "rpm":         round(rpm, 2),
            "distance_cm": round(distance, 2),
        }


async def stream(args: argparse.Namespace) -> None:
    """Connect to backend and stream readings at the requested rate."""
    url = f"ws://{args.host}:{args.port}/telemetry/ingest"
    interval = 1.0 / args.rate
    rng = random.Random(args.seed)

    car = MockCar(
        mode=args.mode,
        pwm=args.pwm,
        fault=args.fault,
        start_fault_after=args.start_fault_after,
        rng=rng,
    )

    total = int(args.duration * args.rate)
    sent = 0
    fault_onset_reported = False

    print(f"[mock_car] Connecting to {url}")
    print(f"[mock_car] mode={args.mode} pwm={args.pwm} fault={args.fault} "
          f"duration={args.duration}s rate={args.rate}Hz start_fault_after={args.start_fault_after}s")

    try:
        async with websockets.connect(url, ping_interval=None) as ws:
            print(f"[mock_car] Connected. Streaming {total} readings…")
            for _ in range(total):
                tick_start = time.perf_counter()

                in_fault = car._in_fault_phase() and args.fault != "none"
                if in_fault and not fault_onset_reported:
                    fault_onset_reported = True
                    print(f"[mock_car] ⚡  FAULT ONSET — {args.fault} begins (t={time.time():.3f})")

                reading = car.next_reading()
                payload = {
                    "car_id":      args.car_id,
                    "timestamp":   time.time(),
                    "mode":        args.mode,
                    "pwm_command": args.pwm,
                    **reading,
                }

                await ws.send(json.dumps(payload))
                sent += 1

                if args.verbose:
                    tag = "FAULT" if in_fault else "OK"
                    print(f"  [{tag}] {json.dumps(reading)}")

                # Rate control — sleep the remainder of the interval
                elapsed = time.perf_counter() - tick_start
                sleep_for = max(0.0, interval - elapsed)
                await asyncio.sleep(sleep_for)

    except (ConnectionRefusedError, OSError) as exc:
        print(f"[mock_car] ERROR: Cannot connect to {url} — {exc}")
        print("[mock_car] Is the backend running?  Try: uvicorn backend.main:app --host 0.0.0.0 --port 8000")
        sys.exit(1)

    print(f"[mock_car] Done. Sent {sent} readings.")


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="MachSight RC car telemetry simulator",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--fault",              default="none",
                        choices=["none", "drag", "jam", "sensor_fault"],
                        help="Fault mode to inject after --start-fault-after seconds")
    parser.add_argument("--duration",           type=float, default=30.0,
                        help="Total run duration in seconds (default: 30)")
    parser.add_argument("--rate",               type=float, default=10.0,
                        help="Readings per second (default: 10)")
    parser.add_argument("--start-fault-after",  type=float, default=5.0, dest="start_fault_after",
                        help="Seconds of healthy data before fault injection (default: 5)")
    parser.add_argument("--host",               default="localhost",
                        help="Backend host (default: localhost)")
    parser.add_argument("--port",               type=int, default=8000,
                        help="Backend port (default: 8000)")
    parser.add_argument("--car-id",             default="car-01", dest="car_id",
                        help="Vehicle identifier (default: car-01)")
    parser.add_argument("--pwm",                type=int, default=200,
                        help="PWM command value 0–255 (default: 200)")
    parser.add_argument("--mode",               default="forward",
                        choices=["idle", "forward", "turning_left", "turning_right", "braking"],
                        help="Operating mode (default: forward)")
    parser.add_argument("--seed",               type=int, default=42,
                        help="Random seed for reproducibility (default: 42)")
    parser.add_argument("--verbose", "-v",      action="store_true",
                        help="Print each reading to stdout")
    return parser.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    asyncio.run(stream(args))

# MachSight Industrial Data Preprocessing & Leakage Prevention

This document specifies the data transformation, unit normalization, feature extraction, and ML leakage prevention standards for the MachSight platform.

---

## 1. Unit Normalization

Transformations across physical dimensions must be explicit, verified, and reversible.

| Quantity | From Unit | To Unit | Conversion Formula | Application |
| :--- | :--- | :--- | :--- | :--- |
| **Angular Velocity** | $\text{rad/s}$ | $\text{RPM}$ | $\text{RPM} = \omega \cdot \frac{60}{2\pi} \approx 9.5493 \cdot \omega$ | LIAS MCSA motor speed conversion |
| **Angular Velocity** | $\text{RPM}$ | $\text{rad/s}$ | $\omega = \text{RPM} \cdot \frac{2\pi}{60} \approx 0.1047 \cdot \text{RPM}$ | Standard mechanical dynamics |
| **Current** | $\text{mA}$ | $\text{A}$ | $I_{\text{A}} = I_{\text{mA}} / 1000$ | Standard sensor scaling |
| **Acceleration** | $g$ | $\text{m/s}^2$ | $a_{\text{m/s}^2} = a_g \cdot 9.80665$ | Vibration acceleration conversion |

All unit conversions are executed through `Preprocessor.convert_unit()`, which explicitly validates physical compatibility and rejects ambiguous transformations.

---

## 2. Sliding Window & Statistical Feature Extraction

For high-frequency vibration and electrical current signals, raw time-series data is segmented into fixed-length windows:

$$\Delta N_{\text{window}} = 2048 \text{ samples}$$

From each window, eight deterministic statistical diagnostic indicators are extracted:

1. **Peak / Extreme Values:** $\max(x)$, $\min(x)$, $\text{Peak-to-Peak} = \max(x) - \min(x)$
2. **Mean & Variance:** $\mu = \frac{1}{N} \sum x_i$, $\sigma^2 = \frac{1}{N} \sum (x_i - \mu)^2$
3. **Root Mean Square (RMS):** $\text{RMS} = \sqrt{\frac{1}{N} \sum x_i^2}$
4. **Skewness:** $\gamma_1 = \frac{1}{N} \sum \left(\frac{x_i - \mu}{\sigma}\right)^3$ (identifies asymmetric impact waves)
5. **Kurtosis:** $\gamma_2 = \frac{1}{N} \sum \left(\frac{x_i - \mu}{\sigma}\right)^4 - 3$ (sensitive indicator for early-stage bearing impulse spikes)
6. **Crest Factor:** $C_f = \frac{\max(|x|)}{\text{RMS}}$ (spikiness indicator)
7. **Form Factor:** $F_f = \frac{\text{RMS}}{\frac{1}{N} \sum |x_i|}$ (shape indicator)

---

## 3. Data Leakage Prevention

Time-series industrial data must not be partitioned using random row-level sampling ($k$-fold row shuffle). Random shuffling causes:
* **Temporal Leakage:** Interleaved samples from the same run appearing in both training and test sets.
* **Auto-correlation Overfitting:** High cross-sample correlation leading to artificially inflated accuracy (e.g. 99.9% test accuracy that collapses in production).

### 3.1 Partitioning Strategies

```text
Run 1 (Healthy)      ──────► Train Partition
Run 2 (Healthy)      ──────► Train Partition
Run 3 (Fault 007)    ──────► Train Partition
Run 4 (Fault 014)    ──────► Validation Partition
Run 5 (Healthy)      ──────► Test Partition
Run 6 (Fault 021)    ──────► Test Partition
```

* **`BY_RUN` / `STRATIFIED_RUN`:** Partitions whole runs/experiments into separate sets. No run appears in more than one partition.
* **`BY_MACHINE`:** For multi-asset fleets, ensures the model is evaluated on machines it has never seen before.
* **`BY_TIME_WINDOW`:** For continuous degradation runs, training strictly precedes validation, which strictly precedes testing in time ($t_{\text{train}} < t_{\text{val}} < t_{\text{test}}$).

### 3.2 Automated Leakage Auditing

The `LeakageDetector` class validates every dataset split:
1. **Run Overlap Check:** Assert $\text{Train} \cap \text{Val} = \emptyset$, $\text{Train} \cap \text{Test} = \emptyset$, $\text{Val} \cap \text{Test} = \emptyset$.
2. **Label Leakage Check:** Scans feature matrix column names for forbidden substrings (`fault`, `label`, `is_anomaly`, `ground_truth`, `target`).
3. **Temporal Monotonicity Check:** Verifies no test timestamp predates training timestamps for a continuous time-series.

---

## 4. Preprocessing Reproducibility

Every preprocessing artifact records:
* `adapter_version`
* `preprocessor_version`
* `window_size` and `step_size`
* `random_seed`
* `config_hash` (deterministic SHA-256 hash of configuration parameters)

# MachSight Industrial Dataset Catalog

This catalog documents the industrial dataset assets evaluated, integrated, or rejected for the MachSight diagnostic platform.

---

## 1. Integrated Datasets Overview

| Dataset ID | Asset / Domain | Physical Sensors | Sampling Rate | Primary Task | License |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `cwru_bearing` | Induction motor rolling element bearings | Drive-end & Fan-end vibration accelerometers (g) | 48,000 Hz / 12,000 Hz | `FAULT_CLASSIFICATION`, `ANOMALY_DETECTION` | Public Domain |
| `mcsadc_rotor_bar` | 1.1 kW 3-phase induction motor | Stator currents ($i_{sa}, i_{sb}, i_{sc}$), voltages ($v_{sa}, v_{sb}, v_{sc}$), speed, position | 1,428.57 Hz | `FAULT_CLASSIFICATION`, `ANOMALY_DETECTION` | Open Research Attribution |
| `electric_motor_temp` | Permanent Magnet Synchronous Motor (PMSM) | d/q voltages, d/q currents, coolant, stator winding/tooth/yoke temps, PM temp, speed, torque | 2 Hz | `ANOMALY_DETECTION`, `AUXILIARY` (Thermal condition monitoring) | CC BY-SA 4.0 |

---

## 2. Detailed Dataset Specifications

### 2.1 CWRU Bearing Vibration Dataset (`cwru_bearing`)

* **Source Organization:** Case Western Reserve University (CWRU) Bearing Data Center.
* **Citation:** Loparo, K. A., *"Bearing Vibration Data Set"*, Case Western Reserve University Data Center, 2012.
* **Source URL:** [https://engineering.case.edu/bearingdatacenter](https://engineering.case.edu/bearingdatacenter)
* **Domain:** Rotating machinery / Rolling element bearings.
* **Machine Type:** 2 HP Reliance Electric induction motor, dynamometer test rig.
* **Sensor Types & Channels:**
  * `de_vibration`: Drive-end bearing housing acceleration (g), PCB 353B33 accelerometer.
  * `fe_vibration`: Fan-end bearing housing acceleration (g), PCB 353B33 accelerometer.
* **Sampling Rate:** 48,000 samples/sec (48 kHz) and 12,000 samples/sec (12 kHz).
* **Operating Conditions:**
  * Motor load: 1.0 HP (Load 1).
  * Rotational speed: ~1772 RPM.
* **Fault Types & Severity:**
  * `ball`: Rolling element electro-discharge machined (EDM) defect (0.007", 0.014", 0.021" diameter).
  * `inner_race`: Bearing inner raceway localized EDM defect (0.007", 0.014", 0.021" diameter).
  * `outer_race`: Bearing outer raceway localized EDM defect at 6 o'clock centered position (0.007", 0.014", 0.021" diameter).
  * `healthy`: Nominal baseline without seeded defect.
* **Failure Progression:** Discrete seeded fault severities (steady-state test bench runs; no continuous run-to-failure degradation).
* **Dataset Size:** 10 raw `.mat` files (~84 MB), precomputed 2048-point feature matrix (2,300 windowed samples), 32x32 CNN spectrogram array (4,600 samples).
* **Suitability:**
  * **Suitable:** Multi-class bearing fault classification, spectral/vibration anomaly detection.
  * **Unsuitable:** Continuous remaining useful life (RUL) estimation or temporal fault onset analysis.
* **License:** Public academic research domain.

---

### 2.2 LIAS MCSA Induction Motor Broken Rotor Bar Dataset (`mcsadc_rotor_bar`)

* **Source Organization:** LIAS Laboratory, University of Poitiers, France.
* **Citation:** Boushaba, A.; Cauet, S.; Chamroo, A.; Etien, E.; Rambault, L. *"Comparative Study between Physics-Informed CNN and PCA in Induction Motor Broken Bars MCSA Detection"*. Sensors 2022, 22, 9494.
* **Source URL:** [https://github.com/LIAS-Lab/MCSA-DC](https://github.com/LIAS-Lab/MCSA-DC)
* **Domain:** Electrical machines / Motor Current Signature Analysis (MCSA).
* **Machine Type:** 1.1 kW, 400 V, 50 Hz, 1425 RPM, 2-pole pairs three-phase squirrel-cage induction motor.
* **Sensor Types & Channels:**
  * Stator Currents: $i_{sa}, i_{sb}, i_{sc}$ (Amperes), Hall-effect current sensors.
  * Stator Voltages: $v_{sa}, v_{sb}, v_{sc}$ (Volts), voltage transducers.
  * Rotor Speed: $\omega$ in rad/s, incremental encoder.
  * Rotor Mechanical Position: $\theta$ in rad, incremental encoder.
* **Sampling Rate:** 1,428.57 Hz ($\Delta t = 0.0007$ s).
* **Operating Conditions:**
  * Low Speed regime: ~1435 RPM ($150.3$ rad/s mechanical).
  * Medium Speed regime: ~1463 RPM ($153.2$ rad/s mechanical).
  * High Speed regime: ~1491 RPM ($156.1$ rad/s mechanical).
* **Fault Types & Severity:**
  * `healthy`: Nominal rotor squirrel-cage (runs 0–17, 20–37, 40–57).
  * `broken_rotor_bar_1`: One broken rotor bar via precision drilling (runs 60–77, 80–97, 100–117).
  * `broken_rotor_bar_2`: Two adjacent broken rotor bars (runs 120–137, 140–157, 160–177).
* **Failure Progression:** Static seeded severity levels across 162 total experiment runs (18 runs per speed/fault combination).
* **Dataset Size:** 162 CSV files (~140 MB total, ~13,340 time steps per run = 2.16M observations).
* **Suitability:**
  * **Suitable:** Broken rotor bar detection, sideband current signature harmonics, stator current anomaly detection.
  * **Unsuitable:** Mechanical bearing race spall analysis.
* **License:** Open Research Attribution License (LIAS Laboratory).

---

### 2.3 Paderborn Electric Motor Temperature Dataset (`electric_motor_temp`)

* **Source Organization:** LEA Department, Paderborn University, Germany.
* **Citation:** Kirchgässner, W., Wallscheid, O., & Böcker, J. (2021). *"Empirical Evaluation of Electric Motor Thermal Modeling using Recurrent Neural Networks"*. IEEE Transactions on Industrial Informatics.
* **Source URL:** [https://www.kaggle.com/datasets/wkirgsn/electric-motor-temperature](https://www.kaggle.com/datasets/wkirgsn/electric-motor-temperature)
* **Domain:** Electric vehicle traction / Permanent Magnet Synchronous Motors (PMSM).
* **Machine Type:** Automotive PMSM mounted on an automated dynamometer test bench.
* **Sensor Types & Channels:**
  * Direct and quadrature axis voltages: $u_d, u_q$ (Volts).
  * Direct and quadrature axis currents: $i_d, i_q$ (Amperes).
  * Thermal sensors: coolant temperature, stator winding temp, stator tooth temp, stator yoke temp, permanent magnet temp (`pm`) (°C).
  * Operating mechanics: motor speed (RPM), shaft torque (Nm), ambient temperature (°C).
* **Sampling Rate:** 2.0 Hz ($\Delta t = 0.5$ s).
* **Operating Conditions:** Dynamic driving cycles (WLTP/FTP profiles) varying torque ($-200$ to $+200$ Nm) and speed ($0$ to $6000$ RPM).
* **Fault / Anomaly Definition:**
  * Thermal overload anomaly: Permanent magnet temperature exceeds critical threshold ($> 100^\circ\text{C}$).
  * Nominal thermal condition: PMSM operating within continuous thermal rating limits.
* **Failure Progression:** Continuous dynamic thermal heating and cooling transients across 69 distinct measurement profiles.
* **Dataset Size:** Single 286 MB CSV file, 1,330,816 sequential records.
* **Suitability:**
  * **Suitable:** Thermal anomaly detection, degradation modeling, regression temperature estimation, auxiliary condition monitoring.
  * **Unsuitable:** Discrete mechanical fault classification (no gear, bearing, or rotor bar failure classes).
* **License:** CC BY-SA 4.0.

---

## 3. Candidate Datasets Evaluated & Status

| Candidate Dataset | Domain | Evaluation Summary | Suitability Classification | Phase 5 Status |
| :--- | :--- | :--- | :--- | :--- |
| **NASA C-MAPSS Turbofan** | Jet engine degradation | 21 sensor channels, run-to-failure degradation trajectories. High value for RUL modeling. | `RUL_DEGRADATION` | Evaluated; adapter postponed to Phase 6 (dedicated degradation phase). |
| **IMS Bearing (NASA)** | Bearing run-to-failure | 4 bearings on shaft run continuously for weeks until outer race/roller failure. Natural degradation. | `ANOMALY_DETECTION`, `RUL_DEGRADATION` | Evaluated; excellent companion for continuous progression. |
| **SEU Gearbox** | Gearbox dynamics | Planetary and spur gearbox tooth missing/chipped/crack defects under varying load. | `FAULT_CLASSIFICATION` | Evaluated; recommended for future mechanical drivetrain expansion. |

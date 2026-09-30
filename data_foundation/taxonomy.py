"""MachSight Fault Taxonomy.

Hierarchical taxonomy representing mechanical, electrical, thermal, and sensor faults
across rotating machinery and industrial systems without conflating disparate failure modes.
"""

from __future__ import annotations

from typing import Dict, List, Optional, Tuple


# Canonical tree definition: (taxonomy_path, component, physical_system, description)
_TAXONOMY_REGISTRY: Dict[str, Tuple[str, str, str]] = {
    # Healthy / Baseline
    "healthy": ("healthy", "system", "Machine operating within nominal healthy baseline parameters"),
    "healthy.baseline": ("healthy", "system", "Baseline operational state"),

    # Mechanical Faults
    "mechanical.bearing.inner_race": ("bearing", "drive_train", "Bearing inner raceway localized spall/defect"),
    "mechanical.bearing.outer_race": ("bearing", "drive_train", "Bearing outer raceway localized spall/defect"),
    "mechanical.bearing.ball": ("bearing", "drive_train", "Bearing rolling element (ball/roller) surface defect"),
    "mechanical.gear.wear": ("gearbox", "drive_train", "Gear tooth surface wear or pitting"),
    "mechanical.shaft.misalignment": ("shaft", "drive_train", "Shaft angular or parallel misalignment"),
    "mechanical.drag": ("wheel_bearing_axle", "drive_train", "Mechanical friction or resistance causing increased load"),
    "mechanical.jam": ("drive_train", "drive_train", "Severe mechanical binding or wheel/rotor stall"),

    # Electrical Faults
    "electrical.rotor.broken_bar": ("rotor", "electromagnetic", "Induction motor broken rotor bar"),
    "electrical.rotor.broken_bar_1": ("rotor", "electromagnetic", "Induction motor single broken rotor bar (drilled defect)"),
    "electrical.rotor.broken_bar_2": ("rotor", "electromagnetic", "Induction motor two adjacent broken rotor bars"),
    "electrical.stator.winding_short": ("stator_winding", "electromagnetic", "Stator inter-turn short circuit"),
    "electrical.current_unbalance": ("motor_phases", "electromagnetic", "Phase current unbalance or phase loss"),

    # Thermal Anomalies
    "thermal.permanent_magnet.overheating": ("permanent_magnet", "thermal_management", "Permanent magnet rotor excessive temperature degradation"),
    "thermal.stator.winding_overheating": ("stator_winding", "thermal_management", "Stator winding thermal overload"),
    "thermal.coolant.insufficient": ("cooling_system", "thermal_management", "Inadequate coolant flow or high inlet temperature"),

    # Sensor Faults
    "sensor.ultrasonic.out_of_range": ("ultrasonic_sensor", "sensor_array", "Ultrasonic distance reading exceeds physical plausible limits"),
    "sensor.ultrasonic.dropout": ("ultrasonic_sensor", "sensor_array", "Sensor signal loss, zero flatline, or communication drop"),
    "sensor.rpm.dropout": ("wheel_encoder", "sensor_array", "Encoder pulse dropout or zero reading while drawing active current"),
    "sensor.current.saturation": ("current_sensor", "sensor_array", "Hall effect current transducer saturation or rail limit"),
}


class FaultTaxonomy:
    """Provides taxonomy path lookup, component inference, and hierarchical validation."""

    @classmethod
    def is_valid_path(cls, path: str) -> bool:
        """Check if path is a registered taxonomy leaf or node."""
        if path in _TAXONOMY_REGISTRY:
            return True
        # Check if it is a prefix of any registered path
        prefix = path + "."
        return any(k.startswith(prefix) for k in _TAXONOMY_REGISTRY)

    @classmethod
    def get_info(cls, path: str) -> Optional[Tuple[str, str, str]]:
        """Return (component, system, description) for a taxonomy path."""
        return _TAXONOMY_REGISTRY.get(path)

    @classmethod
    def get_component(cls, path: str) -> Optional[str]:
        """Return suspected physical component for a taxonomy path."""
        info = cls.get_info(path)
        return info[0] if info else None

    @classmethod
    def get_system(cls, path: str) -> Optional[str]:
        """Return physical system for a taxonomy path."""
        info = cls.get_info(path)
        return info[1] if info else None

    @classmethod
    def get_description(cls, path: str) -> Optional[str]:
        """Return textual description for a taxonomy path."""
        info = cls.get_info(path)
        return info[2] if info else None

    @classmethod
    def get_category(cls, path: str) -> str:
        """Return top-level taxonomy category ('mechanical', 'electrical', 'thermal', 'sensor', 'healthy')."""
        return path.split(".")[0] if "." in path else path

    @classmethod
    def get_parent_path(cls, path: str) -> Optional[str]:
        """Return the parent taxonomy path, or None if at root."""
        if "." not in path:
            return None
        return path.rsplit(".", 1)[0]

    @classmethod
    def list_paths(cls) -> List[str]:
        """List all canonical leaf taxonomy paths."""
        return sorted(list(_TAXONOMY_REGISTRY.keys()))

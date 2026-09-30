import React from 'react';

interface Props {
  readonly suspectedComponent: string | { component_id?: string; display_name?: string } | null | undefined;
}

export const MachineSchematic: React.FC<Props> = ({ suspectedComponent }) => {
  const compRaw = typeof suspectedComponent === 'object' && suspectedComponent !== null
    ? (suspectedComponent.display_name || suspectedComponent.component_id || '')
    : (suspectedComponent || '');
  const comp = compRaw.toLowerCase().trim();

  const isMotorSuspected = comp.includes('motor');
  const isDrivetrainSuspected = comp.includes('drivetrain') || comp.includes('transmission') || comp.includes('gear');
  const isWheelsSuspected = comp.includes('wheel') || comp.includes('bearing') || comp.includes('tire');
  const isUltrasonicSuspected = comp.includes('ultrasonic') || comp.includes('sensor') || comp.includes('range');
  const isBatterySuspected = comp.includes('battery') || comp.includes('power') || comp.includes('voltage');
  const isControllerSuspected = comp.includes('controller') || comp.includes('esc') || comp.includes('pwm');

  const getHighlightClass = (isSuspected: boolean) => {
    if (isSuspected) {
      return {
        fill: '#ef4444',
        fillOpacity: 0.35,
        stroke: '#dc2626',
        strokeWidth: 2.5,
        filter: 'drop-shadow(0 0 6px rgba(239, 68, 68, 0.6))',
      };
    }
    return {
      fill: 'currentColor',
      fillOpacity: 0.08,
      stroke: 'currentColor',
      strokeWidth: 1.25,
      filter: 'none',
    };
  };

  return (
    <div
      data-testid="machine-schematic"
      className="border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm p-4"
    >
      <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-2 mb-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-bold text-zinc-800 dark:text-zinc-200 uppercase tracking-wide">
            VEHICLE SUBSYSTEM TOPOLOGY SCHEMATIC
          </span>
          <span className="text-[10px] font-mono text-zinc-500">RC-01 / CAR-PROTO-01</span>
        </div>
        <div className="font-mono text-[11px]">
          {suspectedComponent ? (
            <span className="px-2 py-0.5 font-bold bg-red-500/20 text-red-400 border border-red-500/40 rounded animate-pulse">
              FAULT ISOLATION: {comp.toUpperCase()}
            </span>
          ) : (
            <span className="text-zinc-400 text-xs">Component not identified</span>
          )}
        </div>
      </div>

      <div className="flex flex-col lg:flex-row items-center justify-around gap-6 py-2">
        {/* Vector SVG Schematic of RC Car Subsystems */}
        <div className="relative w-full max-w-md">
          <svg
            viewBox="0 0 400 240"
            className="w-full h-auto text-zinc-400 dark:text-zinc-600 block"
            style={{ shapeRendering: 'geometricPrecision' }}
          >
            {/* Chassis Outline */}
            <rect
              x="90"
              y="40"
              width="220"
              height="160"
              rx="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeDasharray="4 3"
              className="text-zinc-300 dark:text-zinc-700"
            />

            {/* Front Bumper Ultrasonic Sensor Array */}
            <g>
              <rect
                x="310"
                y="85"
                width="30"
                height="70"
                rx="4"
                style={getHighlightClass(isUltrasonicSuspected)}
              />
              <circle cx="325" cy="105" r="7" style={getHighlightClass(isUltrasonicSuspected)} />
              <circle cx="325" cy="135" r="7" style={getHighlightClass(isUltrasonicSuspected)} />
              <text x="350" y="125" className="fill-zinc-500 font-mono text-[10px]" textAnchor="start">
                Ultrasonic (SIG-01)
              </text>
            </g>

            {/* Wheels */}
            {/* Front-Left Wheel */}
            <rect
              x="260"
              y="15"
              width="45"
              height="20"
              rx="3"
              style={getHighlightClass(isWheelsSuspected)}
            />
            {/* Front-Right Wheel */}
            <rect
              x="260"
              y="205"
              width="45"
              height="20"
              rx="3"
              style={getHighlightClass(isWheelsSuspected)}
            />
            {/* Rear-Left Wheel */}
            <rect
              x="95"
              y="15"
              width="45"
              height="20"
              rx="3"
              style={getHighlightClass(isWheelsSuspected)}
            />
            {/* Rear-Right Wheel */}
            <rect
              x="95"
              y="205"
              width="45"
              height="20"
              rx="3"
              style={getHighlightClass(isWheelsSuspected)}
            />

            {/* Wheel Axel Bars */}
            <line x1="282" y1="35" x2="282" y2="205" stroke="currentColor" strokeWidth="2" />
            <line x1="117" y1="35" x2="117" y2="205" stroke="currentColor" strokeWidth="2" />

            {/* Central Drive Shaft / Drivetrain Transmission */}
            <g>
              <rect
                x="150"
                y="110"
                width="100"
                height="20"
                rx="2"
                style={getHighlightClass(isDrivetrainSuspected)}
              />
              <text x="200" y="124" className="fill-zinc-600 dark:fill-zinc-300 font-mono text-[9px] font-bold" textAnchor="middle">
                DRIVETRAIN
              </text>
            </g>

            {/* Electric Motor Assembly */}
            <g>
              <rect
                x="110"
                y="95"
                width="40"
                height="50"
                rx="4"
                style={getHighlightClass(isMotorSuspected)}
              />
              <text x="130" y="124" className="fill-zinc-600 dark:fill-zinc-300 font-mono text-[9px] font-bold" textAnchor="middle">
                MOTOR
              </text>
            </g>

            {/* Battery Pack */}
            <g>
              <rect
                x="160"
                y="55"
                width="80"
                height="45"
                rx="4"
                style={getHighlightClass(isBatterySuspected)}
              />
              <text x="200" y="81" className="fill-zinc-600 dark:fill-zinc-300 font-mono text-[9px] font-bold" textAnchor="middle">
                BATTERY
              </text>
            </g>

            {/* Controller / ESC Module */}
            <g>
              <rect
                x="160"
                y="140"
                width="80"
                height="45"
                rx="4"
                style={getHighlightClass(isControllerSuspected)}
              />
              <text x="200" y="166" className="fill-zinc-600 dark:fill-zinc-300 font-mono text-[9px] font-bold" textAnchor="middle">
                ESC / MCU
              </text>
            </g>
          </svg>
        </div>

        {/* Legend & Subsystem Status List */}
        <div className="w-full lg:w-64 space-y-2 font-mono text-xs">
          <div className="text-[10px] text-zinc-500 uppercase font-bold mb-2">
            Subsystem Status Legend
          </div>

          {[
            { name: 'Drivetrain Transmission', isSuspected: isDrivetrainSuspected, tag: 'DRV-01' },
            { name: 'DC Drive Motor', isSuspected: isMotorSuspected, tag: 'MTR-01' },
            { name: 'Ultrasonic Array', isSuspected: isUltrasonicSuspected, tag: 'SIG-01' },
            { name: 'Wheel & Bearings', isSuspected: isWheelsSuspected, tag: 'WHL-04' },
            { name: 'Battery / Power Pack', isSuspected: isBatterySuspected, tag: 'PWR-01' },
            { name: 'Electronic Speed Controller', isSuspected: isControllerSuspected, tag: 'ESC-01' },
          ].map((sub) => (
            <div
              key={sub.name}
              className={`flex items-center justify-between p-1.5 border rounded-none transition-colors ${
                sub.isSuspected
                  ? 'border-red-500 bg-red-50/20 text-red-500 dark:text-red-400 font-bold'
                  : 'border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 bg-zinc-50/40 dark:bg-zinc-950/20'
              }`}
            >
              <div className="flex items-center gap-1.5 truncate">
                <span
                  className={`w-2 h-2 rounded-full ${
                    sub.isSuspected ? 'bg-red-500 animate-ping' : 'bg-emerald-500'
                  }`}
                />
                <span className="truncate">{sub.name}</span>
              </div>
              <span className="text-[10px] shrink-0 font-bold">
                {sub.isSuspected ? 'SUSPECT' : 'NOMINAL'}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

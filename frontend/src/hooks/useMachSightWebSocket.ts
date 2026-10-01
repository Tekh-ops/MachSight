import { useState, useEffect, useRef, useCallback } from 'react';
import type {
  ConnectionState,
  MachineHealthStatus,
  TelemetryPoint,
  ParsedDiagnosis,
  TimelineEvent,
  QualityMetrics,
  BackendStatus,
} from '../types/domain';
import { formatTimestamp } from '../utils/formatters';

const MAX_HISTORY_POINTS = 300;
const MAX_TIMELINE_EVENTS = 100;

export interface UseMachSightReturn {
  readonly connectionState: ConnectionState;
  readonly healthStatus: MachineHealthStatus;
  readonly latestTelemetry: TelemetryPoint | null;
  readonly telemetryHistory: readonly TelemetryPoint[];
  readonly latestDiagnosis: ParsedDiagnosis | null;
  readonly diagnosisHistory: readonly ParsedDiagnosis[];
  readonly timelineEvents: readonly TimelineEvent[];
  readonly qualityMetrics: QualityMetrics;
  readonly backendStatus: BackendStatus | null;
  readonly packetCount: number;
  readonly machineId: string;
  readonly highlightMetrics: readonly string[];
  readonly activeAnomalyCount: number;
  readonly reconnect: () => void;
  readonly setCustomWsEndpoint: (url: string) => void;
  readonly wsEndpoint: string;
  readonly updateInterval: number;
  readonly setUpdateInterval: (interval: number) => void;
}

export function useMachSightWebSocket(defaultWsUrl = 'ws://127.0.0.1:8000/ws'): UseMachSightReturn {
  const [wsEndpoint, setWsEndpoint] = useState<string>(defaultWsUrl);
  const [connectionState, setConnectionState] = useState<ConnectionState>('CONNECTING');
  const [latestTelemetry, setLatestTelemetry] = useState<TelemetryPoint | null>(null);
  const [telemetryHistory, setTelemetryHistory] = useState<TelemetryPoint[]>([]);
  const [latestDiagnosis, setLatestDiagnosis] = useState<ParsedDiagnosis | null>(null);
  const [diagnosisHistory, setDiagnosisHistory] = useState<ParsedDiagnosis[]>([]);
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([]);
  const [backendStatus, setBackendStatus] = useState<BackendStatus | null>(null);
  const [packetCount, setPacketCount] = useState<number>(0);
  const [machineId, setMachineId] = useState<string>('rc-sim-01');
  const [highlightMetrics, setHighlightMetrics] = useState<string[]>([]);
  const [activeAnomalyCount, setActiveAnomalyCount] = useState<number>(0);
  const [lifecycleState, setLifecycleState] = useState<string>('HEALTHY');
  const [updateInterval, setUpdateInterval] = useState<number>(100); // Default 100ms

  const [qualityMetrics, setQualityMetrics] = useState<QualityMetrics>({
    packetFreshnessMs: null,
    lastTimestamp: null,
    distancePlausible: true,
    mahalanobisDistance: 0,
    currentZScore: 0,
    rpmZScore: 0,
    bucketUsed: 'default',
    totalPackets: 0,
    totalAnomalies: 0,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef<number>(0);
  const wasAnomalyRef = useRef<boolean>(false);
  const consecutiveAnomalyCountRef = useRef<number>(0);
  const lastDiagIdRef = useRef<string | null>(null);
  const lastTimelineTypeRef = useRef<string | null>(null);
  const lastTimelineTimeRef = useRef<number>(0);
  const lastUpdateTimeRef = useRef<number>(0);

  // Append a timeline event (debounced so identical rapid events are grouped)
  const addTimelineEvent = useCallback((event: Omit<TimelineEvent, 'id' | 'timeFormatted'>) => {
    const now = Date.now();
    // Debounce repeated events of same type within 5 seconds to reduce flow
    if (lastTimelineTypeRef.current === event.type && now - lastTimelineTimeRef.current < 5000) {
      return;
    }
    lastTimelineTypeRef.current = event.type;
    lastTimelineTimeRef.current = now;

    const newEvent: TimelineEvent = {
      ...event,
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timeFormatted: formatTimestamp(event.timestamp),
    };
    setTimelineEvents((prev) => [newEvent, ...prev.slice(0, MAX_TIMELINE_EVENTS - 1)]);
  }, []);

  // Poll backend status via REST
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const httpUrl = wsEndpoint.replace(/^ws/, 'http').replace(/\/ws$/, '');
        const res = await fetch(`${httpUrl}/api/status`);
        if (res.ok) {
          const data = await res.json();
          setBackendStatus(data);
        }
      } catch {
        // Backend temporarily unreachable
      }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [wsEndpoint]);

  // WebSocket Connection Management with Exponential Backoff
  const connect = useCallback(() => {
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // Ignore close errors
      }
    }

    setConnectionState((prev) => (prev === 'DISCONNECTED' ? 'RECONNECTING' : 'CONNECTING'));

    try {
      const ws = new WebSocket(wsEndpoint);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnectionState('CONNECTED');
        reconnectAttemptsRef.current = 0;
        addTimelineEvent({
          timestamp: Date.now(),
          type: 'connection',
          title: 'WebSocket Connected',
          description: `Telemetry stream bus established to ${wsEndpoint}`,
          severity: 'nominal',
        });
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          const eventType = message.type || message.event;

          // Throttle telemetry updates based on updateInterval
          const now = Date.now();
          const shouldProcessTelemetry = eventType === 'processed' && message.data && (now - lastUpdateTimeRef.current >= updateInterval);

          if (shouldProcessTelemetry) {
            lastUpdateTimeRef.current = now;
            const d = message.data;
            const packetTime = d.timestamp ? (d.timestamp < 1e11 ? d.timestamp * 1000 : d.timestamp) : now;
            const freshness = Math.max(0, Math.round(now - packetTime));

            if (d.machine_id) {
              setMachineId(d.machine_id);
            }

            const point: TelemetryPoint = {
              time: formatTimestamp(packetTime),
              timestamp: packetTime,
              distance_cm: d.distance_cm ?? null,
              current_a: d.current_a ?? null,
              rpm: d.rpm ?? null,
              velocity_mps: d.velocity_mps ?? null,
              mode: d.mode ?? 'idle',
              pwm_command: d.pwm_command ?? 0,
              is_anomaly: d.is_anomaly ?? 0,
              mahalanobis_distance: d.mahalanobis_distance ?? 0,
              current_zscore: d.current_zscore ?? 0,
              rpm_zscore: d.rpm_zscore ?? 0,
              distance_plausible: d.distance_plausible ?? 1,
              bucket_used: d.bucket_used ?? 'default',
              raw_id: d.raw_id ?? d.id ?? 0,
              machine_id: d.machine_id ?? machineId,
            };

            setLatestTelemetry(point);
            setPacketCount((c) => c + 1);

            // Maintain rolling history
            setTelemetryHistory((prev) => [...prev.slice(-(MAX_HISTORY_POINTS - 1)), point]);

            // Track anomaly transitions
            const isAnomaly = point.is_anomaly === 1;
            if (isAnomaly) {
              consecutiveAnomalyCountRef.current++;
              setActiveAnomalyCount(consecutiveAnomalyCountRef.current);

              if (!wasAnomalyRef.current) {
                wasAnomalyRef.current = true;
                addTimelineEvent({
                  timestamp: packetTime,
                  type: 'anomaly',
                  title: 'Abnormal Signal Pattern Detected',
                  description: `Current z-score ${point.current_zscore > 0 ? '+' : ''}${point.current_zscore.toFixed(1)}, RPM z-score ${point.rpm_zscore.toFixed(1)}. Mahalanobis distance=${point.mahalanobis_distance.toFixed(1)}`,
                  severity: 'warning',
                });
              }
            } else {
              if (wasAnomalyRef.current) {
                wasAnomalyRef.current = false;
                consecutiveAnomalyCountRef.current = 0;
                setActiveAnomalyCount(0);
                addTimelineEvent({
                  timestamp: packetTime,
                  type: 'recovery',
                  title: 'Telemetry Returned to Baseline',
                  description: 'All sensor streams operating within conditioned baseline tolerances.',
                  severity: 'nominal',
                });
              }
            }

            // Track sensor plausibility transition
            if (point.distance_plausible === 0) {
              addTimelineEvent({
                timestamp: packetTime,
                type: 'sensor_issue',
                title: 'Sensor Implausible',
                description: `Ultrasonic distance reading (${point.distance_cm} cm) is outside plausible operating envelope.`,
                severity: 'warning',
              });
            }

            // Update Quality Metrics
            setQualityMetrics((prev) => ({
              packetFreshnessMs: freshness,
              lastTimestamp: packetTime,
              distancePlausible: point.distance_plausible === 1,
              mahalanobisDistance: point.mahalanobis_distance,
              currentZScore: point.current_zscore,
              rpmZScore: point.rpm_zscore,
              bucketUsed: point.bucket_used,
              totalPackets: prev.totalPackets + 1,
              totalAnomalies: prev.totalAnomalies + (isAnomaly ? 1 : 0),
            }));
          }

          // Always process non-telemetry events (lifecycle, diagnosis, etc.)
          if (eventType === 'lifecycle' && message.data) {
            const state = message.data.state;
            if (state) {
              setLifecycleState(state);
              if (state === 'INVESTIGATING') {
                addTimelineEvent({
                  timestamp: Date.now(),
                  type: 'lifecycle',
                  title: 'Investigation Started',
                  description: 'Abnormal sensor relationship detected — autonomous reasoner analyzing evidence window.',
                  severity: 'info',
                });
              } else if (state === 'RECOVERED') {
                addTimelineEvent({
                  timestamp: Date.now(),
                  type: 'recovery',
                  title: 'Recovery Confirmed',
                  description: 'Telemetry signals returned to healthy baseline. Machine operating normally.',
                  severity: 'nominal',
                });
              }
            }
          } else if (
            (eventType === 'diagnostic_update' && message.data?.diagnosis) ||
            (eventType === 'diagnosis' && message.data)
          ) {
            const rawDiag = message.data.diagnosis || message.data;
            let parsedPayload: ParsedDiagnosis;
            const rawPayload = rawDiag.payload || rawDiag;

            if (typeof rawPayload === 'string') {
              try {
                parsedPayload = JSON.parse(rawPayload);
              } catch {
                parsedPayload = {
                  action: 'diagnose',
                  reasoning: rawPayload,
                  diagnosis: rawPayload,
                  confidence: null,
                  evidence_used: [],
                  recommended_action: null,
                  severity: 'info',
                  ui_hints: { highlight_metrics: [], suggested_charts: [] },
                };
              }
            } else {
              parsedPayload = rawPayload;
            }

            const diagTimestamp = message.data.timestamp
              ? message.data.timestamp < 1e11
                ? message.data.timestamp * 1000
                : message.data.timestamp
              : Date.now();

            const diagnosisWithMeta: ParsedDiagnosis = {
              ...parsedPayload,
              trace_id: message.data.trace_id || parsedPayload.trace_id,
              timestamp: diagTimestamp,
            };

            // Avoid flashing repeated identical diagnoses
            const diagKey = `${diagnosisWithMeta.diagnosis}-${diagnosisWithMeta.severity}-${diagnosisWithMeta.is_recovery ? 'rec' : 'fault'}`;
            const isMeaningfullyDifferent = lastDiagIdRef.current !== diagKey;
            lastDiagIdRef.current = diagKey;

            setLatestDiagnosis(diagnosisWithMeta);
            if (isMeaningfullyDifferent) {
              setDiagnosisHistory((prev) => [diagnosisWithMeta, ...prev.slice(0, 49)]);
            }

            if (diagnosisWithMeta.ui_hints?.highlight_metrics) {
              setHighlightMetrics(diagnosisWithMeta.ui_hints.highlight_metrics as string[]);
            }

            if (isMeaningfullyDifferent) {
              const isRecovery = diagnosisWithMeta.is_recovery === true;
              addTimelineEvent({
                timestamp: diagTimestamp,
                type: isRecovery ? 'recovery' : 'diagnosis',
                title: diagnosisWithMeta.diagnosis || (isRecovery ? 'Recovery Observed' : 'Diagnostic Assessment Generated'),
                description: isRecovery
                  ? 'Sensor signals normalized toward baseline tolerances.'
                  : `Primary hypothesis identified with score ${(diagnosisWithMeta.primary_hypothesis?.diagnostic_score ?? diagnosisWithMeta.confidence ?? 0).toFixed(2)}. Severity: ${diagnosisWithMeta.severity.toUpperCase()}.`,
                severity: isRecovery ? 'nominal' : diagnosisWithMeta.severity === 'critical' ? 'critical' : diagnosisWithMeta.severity === 'warning' ? 'warning' : 'info',
              });
            }
          }
        } catch (err) {
          console.error('Failed to parse incoming WebSocket frame:', err);
        }
      };

      ws.onerror = () => {
        setConnectionState('DISCONNECTED');
      };

      ws.onclose = () => {
        setConnectionState('DISCONNECTED');
        wsRef.current = null;

        // Exponential backoff reconnect: 1s, 2s, 4s, up to 15s max
        const attempts = reconnectAttemptsRef.current;
        const delay = Math.min(1000 * Math.pow(1.5, attempts), 15000);
        reconnectAttemptsRef.current = attempts + 1;

        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
        }

        reconnectTimeoutRef.current = setTimeout(() => {
          setConnectionState('RECONNECTING');
          connect();
        }, delay);
      };
    } catch {
      setConnectionState('DISCONNECTED');
    }
  }, [wsEndpoint, addTimelineEvent, machineId]);

  // Initial connection on mount
  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {
          // Ignore
        }
      }
    };
  }, [connect]);

  // Derive Overall Health Status adhering to Section 5:
  // HEALTHY | INVESTIGATING | FAULT DETECTED | RECOVERING | RECOVERED | OFFLINE
  const healthStatus: MachineHealthStatus = (() => {
    if (connectionState === 'DISCONNECTED' && !latestTelemetry) {
      return 'OFFLINE';
    }

    // Direct mapping from backend lifecycle state if explicitly signaled
    if (lifecycleState === 'INVESTIGATING' || lifecycleState === 'ANALYZING' || lifecycleState === 'FAULT_SUSPECTED') {
      return 'INVESTIGATING';
    }
    if (lifecycleState === 'RECOVERING' || lifecycleState === 'MONITORING') {
      return 'RECOVERING';
    }
    if (lifecycleState === 'RECOVERED') {
      return 'RECOVERED';
    }
    if (lifecycleState === 'FAULT DETECTED' || lifecycleState === 'DIAGNOSED') {
      return 'FAULT DETECTED';
    }
    if (lifecycleState === 'NORMAL' || lifecycleState === 'HEALTHY') {
      return 'HEALTHY';
    }

    // Fallback inference from active diagnosis and telemetry
    if (latestDiagnosis?.is_recovery) {
      return 'RECOVERED';
    }
    if (activeAnomalyCount >= 3 || (latestDiagnosis && latestDiagnosis.severity !== 'info')) {
      return 'FAULT DETECTED';
    }
    if (activeAnomalyCount > 0) {
      return 'INVESTIGATING';
    }
    if (latestTelemetry?.distance_plausible === 0) {
      return 'SENSOR_ISSUE';
    }
    return 'HEALTHY';
  })();

  const manualReconnect = useCallback(() => {
    reconnectAttemptsRef.current = 0;
    connect();
  }, [connect]);

  return {
    connectionState,
    healthStatus,
    latestTelemetry,
    telemetryHistory,
    latestDiagnosis,
    diagnosisHistory,
    timelineEvents,
    qualityMetrics,
    backendStatus,
    packetCount,
    machineId,
    highlightMetrics,
    activeAnomalyCount,
    reconnect: manualReconnect,
    setCustomWsEndpoint: setWsEndpoint,
    wsEndpoint,
    updateInterval,
    setUpdateInterval,
  };
}

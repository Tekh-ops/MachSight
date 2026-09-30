import { useState, useEffect, useRef, useCallback } from 'react';
import { formatTimestamp } from '../utils/formatters';
const MAX_HISTORY_POINTS = 100;
const MAX_TIMELINE_EVENTS = 100;
export function useMachSightWebSocket(defaultWsUrl = 'ws://127.0.0.1:8000/ws') {
    const [wsEndpoint, setWsEndpoint] = useState(defaultWsUrl);
    const [connectionState, setConnectionState] = useState('CONNECTING');
    const [latestTelemetry, setLatestTelemetry] = useState(null);
    const [telemetryHistory, setTelemetryHistory] = useState([]);
    const [latestDiagnosis, setLatestDiagnosis] = useState(null);
    const [diagnosisHistory, setDiagnosisHistory] = useState([]);
    const [timelineEvents, setTimelineEvents] = useState([]);
    const [backendStatus, setBackendStatus] = useState(null);
    const [packetCount, setPacketCount] = useState(0);
    const [machineId, setMachineId] = useState('rc-sim-01');
    const [highlightMetrics, setHighlightMetrics] = useState([]);
    const [activeAnomalyCount, setActiveAnomalyCount] = useState(0);
    const [qualityMetrics, setQualityMetrics] = useState({
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
    const wsRef = useRef(null);
    const reconnectTimeoutRef = useRef(null);
    const reconnectAttemptsRef = useRef(0);
    const wasAnomalyRef = useRef(false);
    const consecutiveAnomalyCountRef = useRef(0);
    // Append a timeline event
    const addTimelineEvent = useCallback((event) => {
        const newEvent = {
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
            }
            catch {
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
            }
            catch {
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
                    if (eventType === 'processed' && message.data) {
                        const d = message.data;
                        const now = Date.now();
                        const packetTime = d.timestamp ? (d.timestamp < 1e11 ? d.timestamp * 1000 : d.timestamp) : now;
                        const freshness = Math.max(0, Math.round(now - packetTime));
                        if (d.machine_id) {
                            setMachineId(d.machine_id);
                        }
                        const point = {
                            time: formatTimestamp(packetTime),
                            timestamp: packetTime,
                            distance_cm: d.distance_cm ?? null,
                            current_a: d.current_a ?? null,
                            rpm: d.rpm ?? null,
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
                                    title: 'Anomaly Detected',
                                    description: `Statistical Mahalanobis distance exceeded threshold (${point.mahalanobis_distance.toFixed(2)}). Z-scores: Current=${point.current_zscore.toFixed(1)}, RPM=${point.rpm_zscore.toFixed(1)}`,
                                    severity: 'critical',
                                });
                            }
                        }
                        else {
                            if (wasAnomalyRef.current) {
                                wasAnomalyRef.current = false;
                                consecutiveAnomalyCountRef.current = 0;
                                setActiveAnomalyCount(0);
                                addTimelineEvent({
                                    timestamp: packetTime,
                                    type: 'recovery',
                                    title: 'Telemetry Normalized',
                                    description: 'All sensor streams returned to within conditioned baseline tolerances.',
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
                    else if (eventType === 'diagnosis' && message.data) {
                        let parsedPayload;
                        const rawPayload = message.data.payload;
                        if (typeof rawPayload === 'string') {
                            try {
                                parsedPayload = JSON.parse(rawPayload);
                            }
                            catch {
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
                        }
                        else {
                            parsedPayload = rawPayload;
                        }
                        // Enrich with event metadata
                        const diagnosisWithMeta = {
                            ...parsedPayload,
                            trace_id: message.data.trace_id,
                            timestamp: message.data.timestamp
                                ? (message.data.timestamp < 1e11 ? message.data.timestamp * 1000 : message.data.timestamp)
                                : Date.now(),
                        };
                        setLatestDiagnosis(diagnosisWithMeta);
                        setDiagnosisHistory((prev) => [diagnosisWithMeta, ...prev.slice(0, 49)]);
                        if (diagnosisWithMeta.ui_hints?.highlight_metrics) {
                            setHighlightMetrics(diagnosisWithMeta.ui_hints.highlight_metrics);
                        }
                        addTimelineEvent({
                            timestamp: diagnosisWithMeta.timestamp || Date.now(),
                            type: 'diagnosis',
                            title: diagnosisWithMeta.diagnosis || 'Diagnostic Assessment Generated',
                            description: `Suspected Component: ${diagnosisWithMeta.suspected_component || 'Not identified'}. Severity: ${diagnosisWithMeta.severity}. Stage: ${diagnosisWithMeta.stage || 'final'}.`,
                            severity: diagnosisWithMeta.severity === 'critical' ? 'critical' : diagnosisWithMeta.severity === 'warning' ? 'warning' : 'info',
                        });
                    }
                }
                catch (err) {
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
        }
        catch {
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
                }
                catch {
                    // Ignore
                }
            }
        };
    }, [connect]);
    // Derive Overall Health Status
    const healthStatus = (() => {
        if (connectionState === 'DISCONNECTED' && !latestTelemetry) {
            return 'UNKNOWN';
        }
        if (latestTelemetry?.distance_plausible === 0) {
            return 'SENSOR_ISSUE';
        }
        if (latestTelemetry?.is_anomaly === 1 || activeAnomalyCount > 0) {
            return 'ANOMALY';
        }
        if (latestDiagnosis?.severity === 'warning') {
            return 'ATTENTION';
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
    };
}
//# sourceMappingURL=useMachSightWebSocket.js.map
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  stepFunctionsService,
  ExecutionHistoryEvent,
  StepFunctionExecution,
} from '../../services/stepFunctions';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import './ExecutionDetails.css';

interface ExecutionDetailsProps {
  execution?: StepFunctionExecution;
  onClose?: () => void;
}

type TopTab = 'overview' | 'input-output' | 'definition' | 'events';
type StepTab = 'input-output' | 'details' | 'definition' | 'events';
type GraphTab = 'graph' | 'table';
type StepStatus = 'succeeded' | 'failed' | 'running' | 'pending';

const TOP_HEIGHT_MIN = 140;
const TOP_HEIGHT_MAX = 560;
const TOP_HEIGHT_DEFAULT = 240;
const GRAPH_WIDTH_MIN_PX = 280;
const GRAPH_WIDTH_DEFAULT_PX = 420;
const STEP_PANEL_MIN_PX = 280;

const TOP_HEIGHT_KEY = 'exec-details-top-height';
const GRAPH_WIDTH_KEY = 'exec-details-graph-width';

/* ============================================================
 * JsonViewer — collapsible JSON tree
 * ========================================================== */

interface JsonViewerProps {
  data: unknown;
  isError?: boolean;
  maxHeight?: string;
}

const JsonViewer: React.FC<JsonViewerProps> = ({
  data,
  isError = false,
  maxHeight = '320px',
}) => {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['root']));

  const toggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const indentFor = (d: number) => '  '.repeat(d);

  const renderValue = (
    value: any,
    path = 'root',
    depth = 0,
    key?: string
  ): React.ReactNode => {
    const indent = indentFor(depth);
    const keyJsx = key !== undefined && (
      <>
        <span className="exd-json-key">"{key}"</span>
        <span>: </span>
      </>
    );

    if (value === null) {
      return (
        <div className="exd-json-line" key={path}>
          <span>{indent}</span>
          {keyJsx}
          <span className="exd-json-null">null</span>
        </div>
      );
    }

    if (value === undefined) {
      return (
        <div className="exd-json-line" key={path}>
          <span>{indent}</span>
          {keyJsx}
          <span className="exd-json-null">undefined</span>
        </div>
      );
    }

    if (typeof value === 'string') {
      const isErrorString =
        isError &&
        (key === 'error' || key === 'errorMessage' || key === 'cause');
      return (
        <div className="exd-json-line" key={path}>
          <span>{indent}</span>
          {keyJsx}
          <span
            className={
              isErrorString
                ? 'exd-json-error-string'
                : 'exd-json-string'
            }
          >
            "{value}"
          </span>
        </div>
      );
    }

    if (typeof value === 'number') {
      return (
        <div className="exd-json-line" key={path}>
          <span>{indent}</span>
          {keyJsx}
          <span className="exd-json-number">{value}</span>
        </div>
      );
    }

    if (typeof value === 'boolean') {
      return (
        <div className="exd-json-line" key={path}>
          <span>{indent}</span>
          {keyJsx}
          <span className="exd-json-boolean">{value.toString()}</span>
        </div>
      );
    }

    if (Array.isArray(value)) {
      if (value.length === 0) {
        return (
          <div className="exd-json-line" key={path}>
            <span>{indent}</span>
            {keyJsx}
            <span className="exd-json-bracket">[]</span>
          </div>
        );
      }
      const isExpanded = expanded.has(path);
      return (
        <React.Fragment key={path}>
          <div className="exd-json-line">
            <span>{indent}</span>
            {keyJsx}
            <span
              className="exd-json-toggle"
              onClick={() => toggle(path)}
            >
              <span
                className={`exd-json-arrow${
                  isExpanded ? ' exd-json-arrow--expanded' : ''
                }`}
              >
                
              </span>
              <span className="exd-json-bracket">[</span>
              {!isExpanded && (
                <span className="exd-json-ellipsis">
                  …{value.length} items
                </span>
              )}
            </span>
            {!isExpanded && <span className="exd-json-bracket">]</span>}
          </div>
          {isExpanded && (
            <>
              {value.map((item, idx) =>
                renderValue(
                  item,
                  `${path}[${idx}]`,
                  depth + 1,
                  idx.toString()
                )
              )}
              <div className="exd-json-line">
                <span>{indent}</span>
                <span className="exd-json-bracket">]</span>
              </div>
            </>
          )}
        </React.Fragment>
      );
    }

    if (typeof value === 'object') {
      const keys = Object.keys(value);
      if (keys.length === 0) {
        return (
          <div className="exd-json-line" key={path}>
            <span>{indent}</span>
            {keyJsx}
            <span className="exd-json-brace">{'{}'}</span>
          </div>
        );
      }
      const isExpanded = expanded.has(path);
      return (
        <React.Fragment key={path}>
          <div className="exd-json-line">
            <span>{indent}</span>
            {keyJsx}
            <span
              className="exd-json-toggle"
              onClick={() => toggle(path)}
            >
              <span
                className={`exd-json-arrow${
                  isExpanded ? ' exd-json-arrow--expanded' : ''
                }`}
              >
                
              </span>
              <span className="exd-json-brace">{'{'}</span>
              {!isExpanded && (
                <span className="exd-json-ellipsis">
                  …{keys.length} keys
                </span>
              )}
            </span>
            {!isExpanded && <span className="exd-json-brace">{'}'}</span>}
          </div>
          {isExpanded && (
            <>
              {keys.map((k) =>
                renderValue(value[k], `${path}.${k}`, depth + 1, k)
              )}
              <div className="exd-json-line">
                <span>{indent}</span>
                <span className="exd-json-brace">{'}'}</span>
              </div>
            </>
          )}
        </React.Fragment>
      );
    }

    return (
      <div className="exd-json-line" key={path}>
        <span>{indent}</span>
        {keyJsx}
        <span>{String(value)}</span>
      </div>
    );
  };

  if (data === null || data === undefined) {
    return (
      <div
        className={`exd-json${isError ? ' exd-json--error' : ''}`}
        style={{ maxHeight }}
      >
        <div className="exd-json-line">
          <span className="exd-json-null">
            {data === null ? 'null' : 'undefined'}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`exd-json${isError ? ' exd-json--error' : ''}`}
      style={{ maxHeight }}
    >
      {renderValue(data)}
    </div>
  );
};

/* ============================================================
 * EventRow
 * ========================================================== */

interface EventRowProps {
  event: ExecutionHistoryEvent;
  formatDate: (ds: string) => string;
  showStepCol?: boolean;
}

const EventRow: React.FC<EventRowProps> = ({
  event,
  formatDate,
  showStepCol = false,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const getStepName = () => {
    if (event.stateEnteredEventDetails?.name)
      return event.stateEnteredEventDetails.name;
    if (event.stateExitedEventDetails?.name)
      return event.stateExitedEventDetails.name;
    if (event.taskStateEnteredEventDetails?.name)
      return event.taskStateEnteredEventDetails.name;
    if (event.type.includes('Execution')) return 'Execution';
    return '—';
  };

  const getEventDetails = () => {
    if (event.taskScheduledEventDetails) return event.taskScheduledEventDetails;
    if (event.stateEnteredEventDetails) return event.stateEnteredEventDetails;
    if (event.stateExitedEventDetails) return event.stateExitedEventDetails;
    if (event.taskStateEnteredEventDetails)
      return event.taskStateEnteredEventDetails;
    if (event.taskSucceededEventDetails) return event.taskSucceededEventDetails;
    if (event.taskFailedEventDetails) return event.taskFailedEventDetails;
    if (event.lambdaFunctionSucceededEventDetails)
      return event.lambdaFunctionSucceededEventDetails;
    if (event.lambdaFunctionFailedEventDetails)
      return event.lambdaFunctionFailedEventDetails;
    if (event.executionStartedEventDetails)
      return event.executionStartedEventDetails;
    if (event.executionSucceededEventDetails)
      return event.executionSucceededEventDetails;
    if (event.executionFailedEventDetails)
      return event.executionFailedEventDetails;
    return {
      eventId: event.id,
      eventType: event.type,
      timestamp: event.timestamp,
      previousEventId: event.previousEventId,
    };
  };

  const variant = event.type.includes('Failed')
    ? 'failed'
    : event.type.includes('Succeeded')
    ? 'success'
    : event.type.includes('Started') || event.type.includes('Entered')
    ? 'running'
    : 'default';

  const colSpan = showStepCol ? 5 : 4;

  return (
    <>
      <tr
        className="exd-event-row"
        onClick={() => setIsExpanded((s) => !s)}
      >
        <td style={{ width: 32 }}>
          <span
            className={`exd-expand-arrow${
              isExpanded ? ' exd-expand-arrow--expanded' : ''
            }`}
          >
            
          </span>
        </td>
        <td style={{ width: 60 }}>{event.id}</td>
        <td>
          <span className="exd-event-glyph">
            <span
              className={`exd-event-glyph-icon exd-event-glyph-icon--${variant}`}
            >
              {variant === 'success'
                ? ''
                : variant === 'failed'
                ? ''
                : variant === 'running'
                ? ''
                : '•'}
            </span>
            <span>{event.type}</span>
          </span>
        </td>
        {showStepCol && <td>{getStepName()}</td>}
        <td className="exd-info-mono">{formatDate(event.timestamp)}</td>
      </tr>
      {isExpanded && (
        <tr className="exd-event-detail-row">
          <td colSpan={colSpan}>
            <div className="exd-event-detail-wrap">
              <h5 className="exd-event-detail-title">Event details</h5>
              <JsonViewer data={getEventDetails()} maxHeight="220px" />
            </div>
          </td>
        </tr>
      )}
    </>
  );
};

/* ============================================================
 * ExecutionDetails main
 * ========================================================== */

const ExecutionDetails: React.FC<ExecutionDetailsProps> = ({
  execution: propExecution,
  onClose,
}) => {
  const { executionArn } = useParams<{ executionArn: string }>();
  const navigate = useNavigate();

  const [execution, setExecution] = useState<StepFunctionExecution | null>(
    propExecution || null
  );
  const [history, setHistory] = useState<ExecutionHistoryEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pollingInterval, setPollingInterval] =
    useState<NodeJS.Timeout | null>(null);

  const [eventSearchFilter, setEventSearchFilter] = useState<string>('');
  const [eventDateFilter, setEventDateFilter] = useState<string>('');
  const [eventTypeFilter, setEventTypeFilter] = useState<string>('');

  const [activeViewTab, setActiveViewTab] = useState<TopTab>('overview');
  const [selectedStep, setSelectedStep] = useState<string | null>(null);
  const [activeStepTab, setActiveStepTab] = useState<StepTab>('input-output');
  const [activeGraphTab, setActiveGraphTab] = useState<GraphTab>('graph');

  const [stateMachineDefinition, setStateMachineDefinition] =
    useState<any>(null);
  const [definitionLoading, setDefinitionLoading] = useState(false);
  const [definitionError, setDefinitionError] = useState<string | null>(null);

  const [showNewExecutionModal, setShowNewExecutionModal] = useState(false);
  const [newExecutionInput, setNewExecutionInput] = useState('{}');
  const [isStartingExecution, setIsStartingExecution] = useState(false);
  const [isRedriving, setIsRedriving] = useState(false);

  /* ---------- Resize state ---------- */
  const splitRef = useRef<HTMLDivElement>(null);
  const [topHeight, setTopHeight] = useState<number>(() => {
    const saved =
      typeof window !== 'undefined'
        ? localStorage.getItem(TOP_HEIGHT_KEY)
        : null;
    const parsed = saved ? parseInt(saved, 10) : NaN;
    return Number.isFinite(parsed)
      ? clamp(parsed, TOP_HEIGHT_MIN, TOP_HEIGHT_MAX)
      : TOP_HEIGHT_DEFAULT;
  });
  const [graphWidth, setGraphWidth] = useState<number>(() => {
    const saved =
      typeof window !== 'undefined'
        ? localStorage.getItem(GRAPH_WIDTH_KEY)
        : null;
    const parsed = saved ? parseInt(saved, 10) : NaN;
    return Number.isFinite(parsed) ? parsed : GRAPH_WIDTH_DEFAULT_PX;
  });
  const [resizingV, setResizingV] = useState(false);
  const [resizingH, setResizingH] = useState(false);

  useDocumentTitle(execution?.name || 'Execution');

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingInterval) clearInterval(pollingInterval);
    };
  }, [pollingInterval]);

  /* ---------- Loaders ---------- */

  const loadExecution = async (arn: string) => {
    setLoading(true);
    setError(null);
    try {
      const [executionData, historyData, stateMachineData] = await Promise.all(
        [
          stepFunctionsService.describeExecution(arn),
          stepFunctionsService.getExecutionHistory(arn),
          stepFunctionsService.describeStateMachineForExecution(arn),
        ]
      );

      setExecution(executionData);
      setHistory(historyData || []);

      if (stateMachineData?.definition) {
        try {
          setStateMachineDefinition(
            typeof stateMachineData.definition === 'string'
              ? JSON.parse(stateMachineData.definition)
              : stateMachineData.definition
          );
        } catch {
          setDefinitionError('Failed to parse state machine definition');
          setStateMachineDefinition(null);
        }
      } else {
        setStateMachineDefinition(null);
        setDefinitionError('No definition found in response');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load execution');
    } finally {
      setLoading(false);
    }
  };

  const loadExecutionHistory = async (arn: string) => {
    setLoading(true);
    setError(null);
    try {
      const [historyData, stateMachineData] = await Promise.all([
        stepFunctionsService.getExecutionHistory(arn),
        stepFunctionsService.describeStateMachineForExecution(arn),
      ]);
      setHistory(historyData || []);
      if (!stateMachineDefinition && stateMachineData?.definition) {
        try {
          setStateMachineDefinition(
            typeof stateMachineData.definition === 'string'
              ? JSON.parse(stateMachineData.definition)
              : stateMachineData.definition
          );
        } catch {
          setDefinitionError('Failed to parse state machine definition');
          setStateMachineDefinition(null);
        }
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to load execution history'
      );
    } finally {
      setLoading(false);
    }
  };

  const loadExecutionDetails = async (arn: string) => {
    setLoading(true);
    setError(null);
    try {
      const [executionData, historyData, stateMachineData] = await Promise.all(
        [
          stepFunctionsService.describeExecution(arn),
          stepFunctionsService.getExecutionHistory(arn),
          stepFunctionsService.describeStateMachineForExecution(arn),
        ]
      );

      setExecution(executionData);
      setHistory(historyData || []);

      if (stateMachineData?.definition) {
        try {
          setStateMachineDefinition(
            typeof stateMachineData.definition === 'string'
              ? JSON.parse(stateMachineData.definition)
              : stateMachineData.definition
          );
        } catch {
          setDefinitionError('Failed to parse state machine definition');
          setStateMachineDefinition(null);
        }
      } else {
        setStateMachineDefinition(null);
        setDefinitionError('No definition found in response');
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to load execution details'
      );
    } finally {
      setLoading(false);
    }
  };

  // Initial load by ARN
  useEffect(() => {
    if (executionArn && !propExecution) {
      loadExecution(executionArn);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [executionArn, propExecution]);

  // Load history when execution is provided as a prop
  useEffect(() => {
    if (propExecution?.executionArn && history.length === 0) {
      loadExecutionHistory(propExecution.executionArn);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propExecution?.executionArn]);

  const loadStateMachineDefinition = async (arn: string) => {
    setDefinitionLoading(true);
    setDefinitionError(null);
    try {
      const data =
        await stepFunctionsService.describeStateMachineForExecution(arn);
      if (data?.definition) {
        try {
          setStateMachineDefinition(
            typeof data.definition === 'string'
              ? JSON.parse(data.definition)
              : data.definition
          );
        } catch {
          setDefinitionError('Failed to parse state machine definition');
          setStateMachineDefinition(null);
        }
      } else {
        setStateMachineDefinition(null);
        setDefinitionError('No definition found in response');
      }
    } catch (err) {
      setDefinitionError(
        err instanceof Error ? err.message : 'Failed to load definition'
      );
    } finally {
      setDefinitionLoading(false);
    }
  };

  /* ---------- Step helpers (preserved exactly) ---------- */

  const getUniqueSteps = () => {
    const steps = new Set<string>();

    history.forEach((event) => {
      let stepName: string | null = null;

      if (event.stateEnteredEventDetails?.name) {
        stepName = event.stateEnteredEventDetails.name;
      } else if (event.stateExitedEventDetails?.name) {
        stepName = event.stateExitedEventDetails.name;
      } else if (event.taskStateEnteredEventDetails?.name) {
        stepName = event.taskStateEnteredEventDetails.name;
      } else if (
        event.taskSucceededEventDetails &&
        event.type === 'TaskSucceeded'
      ) {
        const related = history
          .slice(0, event.id)
          .reverse()
          .find(
            (e) =>
              e.type === 'TaskStateEntered' || e.type === 'StateEntered'
          );
        stepName =
          related?.stateEnteredEventDetails?.name ||
          related?.taskStateEnteredEventDetails?.name ||
          null;
      } else if (event.taskFailedEventDetails && event.type === 'TaskFailed') {
        const related = history
          .slice(0, event.id)
          .reverse()
          .find(
            (e) =>
              e.type === 'TaskStateEntered' || e.type === 'StateEntered'
          );
        stepName =
          related?.stateEnteredEventDetails?.name ||
          related?.taskStateEnteredEventDetails?.name ||
          null;
      }

      if (stepName && stepName !== 'Execution') steps.add(stepName);
    });

    if (steps.size === 0) {
      const types = new Set(history.map((e) => e.type));
      if (types.has('ExecutionStarted')) steps.add('Start');
      if (
        types.has('TaskScheduled') ||
        types.has('TaskSucceeded') ||
        types.has('TaskFailed')
      ) {
        steps.add('Task');
      }
      if (types.has('ExecutionSucceeded')) steps.add('Success');
      if (types.has('ExecutionFailed')) steps.add('Failed');
    }

    return Array.from(steps);
  };

  const getStepEvents = (stepName: string) => {
    if (stepName === 'Start')
      return history.filter((e) => e.type === 'ExecutionStarted');
    if (stepName === 'Task')
      return history.filter(
        (e) => e.type.includes('Task') || e.type.includes('Lambda')
      );
    if (stepName === 'Success')
      return history.filter((e) => e.type === 'ExecutionSucceeded');
    if (stepName === 'Failed')
      return history.filter((e) => e.type === 'ExecutionFailed');

    const stepEntryEvent = history.find(
      (e) =>
        e.stateEnteredEventDetails?.name === stepName ||
        e.taskStateEnteredEventDetails?.name === stepName
    );
    if (!stepEntryEvent) return [];

    const stepExitEvent = history.find(
      (e) => e.stateExitedEventDetails?.name === stepName
    );

    const startId = stepEntryEvent.id;
    const endId = stepExitEvent ? stepExitEvent.id : startId + 10;

    return history
      .filter((e) => {
        if (e.id < startId || e.id > endId) return false;
        const eventStepName =
          e.stateEnteredEventDetails?.name ||
          e.stateExitedEventDetails?.name ||
          e.taskStateEnteredEventDetails?.name;
        if (eventStepName === stepName) return true;
        return (
          e.type.includes('Task') ||
          e.type.includes('Lambda') ||
          e.type.includes('Activity') ||
          e.type.includes('Pass') ||
          e.type.includes('Choice') ||
          e.type.includes('Wait') ||
          e.type.includes('Parallel') ||
          e.type.includes('Map')
        );
      })
      .sort((a, b) => a.id - b.id);
  };

  const getStepStatus = (stepName: string): StepStatus => {
    const events = getStepEvents(stepName);
    const sorted = [...events].sort((a, b) => b.id - a.id);
    for (const event of sorted) {
      if (event.type.includes('Succeeded') || event.type.includes('Exited'))
        return 'succeeded';
      if (
        event.type.includes('Failed') ||
        event.type.includes('TimedOut') ||
        event.type.includes('Aborted')
      )
        return 'failed';
    }
    const hasStarted = events.some(
      (e) =>
        e.type.includes('Started') ||
        e.type.includes('Entered') ||
        e.type.includes('Scheduled')
    );
    return hasStarted ? 'running' : 'pending';
  };

  const getStepType = (stepName: string) => {
    const events = getStepEvents(stepName);
    const taskEvent = events.find((e) => e.type === 'TaskScheduled');
    return taskEvent?.taskScheduledEventDetails?.resourceType || 'Task';
  };

  const getStepDuration = (stepName: string) => {
    const events = getStepEvents(stepName);
    const startEvent = events.find(
      (e) => e.type.includes('Entered') || e.type.includes('Started')
    );
    const endEvent = events.find(
      (e) =>
        e.type.includes('Exited') ||
        e.type.includes('Succeeded') ||
        e.type.includes('Failed')
    );
    if (startEvent && endEvent) {
      const duration =
        new Date(endEvent.timestamp).getTime() -
        new Date(startEvent.timestamp).getTime();
      return formatDuration(duration);
    }
    return '—';
  };

  const getStepResource = (stepName: string) => {
    const events = getStepEvents(stepName);
    const taskEvent = events.find((e) => e.type === 'TaskScheduled');
    if (taskEvent?.taskScheduledEventDetails) {
      const { resourceType, resource } = taskEvent.taskScheduledEventDetails;
      if (resourceType && resource) return `${resourceType}:${resource}`;
      if (taskEvent.taskScheduledEventDetails.resource) {
        const fullResource = taskEvent.taskScheduledEventDetails.resource;
        if (fullResource.includes('arn:aws:states:::aws-sdk:'))
          return fullResource.replace('arn:aws:states:::', '');
        if (fullResource.includes('lambda:invoke')) {
          const match = fullResource.match(/function:([^:]+)/);
          if (match) return `Lambda Function: ${match[1]}`;
        }
        return fullResource;
      }
    }
    return '';
  };

  const getStepDefinition = (stepName: string) => {
    if (!stateMachineDefinition) return null;
    try {
      const def =
        typeof stateMachineDefinition === 'string'
          ? JSON.parse(stateMachineDefinition)
          : stateMachineDefinition;
      return def.States?.[stepName] || null;
    } catch {
      return null;
    }
  };

  const getStepInput = (stepName: string) => {
    const events = getStepEvents(stepName);
    const inputEvent = events.find((e) =>
      [
        'TaskScheduled',
        'StateEntered',
        'TaskStateEntered',
        'ExecutionStarted',
        'LambdaFunctionScheduled',
        'ActivityScheduled',
      ].includes(e.type)
    );

    const tryParse = (val?: string) => {
      if (!val) return undefined;
      try {
        return JSON.parse(val);
      } catch {
        return val;
      }
    };

    if (inputEvent?.taskScheduledEventDetails?.parameters)
      return tryParse(inputEvent.taskScheduledEventDetails.parameters);
    if (inputEvent?.stateEnteredEventDetails?.input)
      return tryParse(inputEvent.stateEnteredEventDetails.input);
    if (inputEvent?.taskStateEnteredEventDetails?.input)
      return tryParse(inputEvent.taskStateEnteredEventDetails.input);
    if (inputEvent?.executionStartedEventDetails?.input)
      return tryParse(inputEvent.executionStartedEventDetails.input);

    for (const event of events) {
      if (event.stateEnteredEventDetails?.input)
        return tryParse(event.stateEnteredEventDetails.input);
      if (event.taskStateEnteredEventDetails?.input)
        return tryParse(event.taskStateEnteredEventDetails.input);
      if (event.taskScheduledEventDetails?.parameters)
        return tryParse(event.taskScheduledEventDetails.parameters);
    }
    return {};
  };

  const getStepOutput = (stepName: string) => {
    const events = getStepEvents(stepName);
    const outputEvent = events.find((e) =>
      [
        'TaskSucceeded',
        'StateExited',
        'LambdaFunctionSucceeded',
        'ActivitySucceeded',
        'ExecutionSucceeded',
      ].includes(e.type)
    );

    const tryParse = (val?: string) => {
      if (!val) return undefined;
      try {
        return JSON.parse(val);
      } catch {
        return val;
      }
    };

    if (outputEvent?.taskSucceededEventDetails?.output)
      return tryParse(outputEvent.taskSucceededEventDetails.output);
    if (outputEvent?.stateExitedEventDetails?.output)
      return tryParse(outputEvent.stateExitedEventDetails.output);
    if (outputEvent?.lambdaFunctionSucceededEventDetails?.output)
      return tryParse(outputEvent.lambdaFunctionSucceededEventDetails.output);
    if (outputEvent?.executionSucceededEventDetails?.output)
      return tryParse(outputEvent.executionSucceededEventDetails.output);

    const failedEvent = events.find((e) =>
      [
        'TaskFailed',
        'LambdaFunctionFailed',
        'ExecutionFailed',
        'ActivityFailed',
      ].includes(e.type)
    );
    if (failedEvent?.taskFailedEventDetails)
      return failedEvent.taskFailedEventDetails;
    if (failedEvent?.lambdaFunctionFailedEventDetails)
      return failedEvent.lambdaFunctionFailedEventDetails;
    if (failedEvent?.executionFailedEventDetails)
      return failedEvent.executionFailedEventDetails;

    for (const event of events) {
      if (event.stateExitedEventDetails?.output)
        return tryParse(event.stateExitedEventDetails.output);
      if (event.taskSucceededEventDetails?.output)
        return tryParse(event.taskSucceededEventDetails.output);
      if (event.lambdaFunctionSucceededEventDetails?.output)
        return tryParse(event.lambdaFunctionSucceededEventDetails.output);
      if (event.executionSucceededEventDetails?.output)
        return tryParse(event.executionSucceededEventDetails.output);
    }
    return {};
  };

  /* ---------- Format helpers ---------- */

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleString();

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
    return `${(ms / 3600000).toFixed(1)}h`;
  };

  /* ---------- Actions ---------- */

  const refreshExecution = async () => {
    if (!execution?.executionArn) return;
    if (propExecution) {
      await loadExecutionHistory(execution.executionArn);
    } else {
      await loadExecutionDetails(execution.executionArn);
    }
  };

  const handleStopExecution = async () => {
    if (!execution?.executionArn) return;
    try {
      await stepFunctionsService.stopExecution(execution.executionArn);
      await refreshExecution();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop execution');
    }
  };

  const handleNewExecution = async () => {
    if (!execution?.stateMachineArn) return;
    setIsStartingExecution(true);
    try {
      const result = await stepFunctionsService.startExecution(
        execution.stateMachineArn,
        undefined,
        newExecutionInput
      );
      if (result?.executionArn) {
        setShowNewExecutionModal(false);
        setNewExecutionInput('{}');
        await loadExecutionDetails(result.executionArn);
        startPolling(result.executionArn);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to start new execution'
      );
    } finally {
      setIsStartingExecution(false);
    }
  };

  const handleRedriveExecution = async () => {
    if (!execution?.executionArn) return;
    setIsRedriving(true);
    try {
      const result = await stepFunctionsService.redriveExecution(
        execution.executionArn
      );
      if (result) {
        setExecution((prev) => (prev ? { ...prev, status: 'RUNNING' } : null));
        startPolling();
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to redrive execution'
      );
    } finally {
      setIsRedriving(false);
    }
  };

  const startPolling = (arn?: string) => {
    const targetArn = arn || execution?.executionArn;
    if (!targetArn) return;
    if (pollingInterval) clearInterval(pollingInterval);

    const interval = setInterval(async () => {
      try {
        const [executionData, historyData] = await Promise.all([
          stepFunctionsService.describeExecution(targetArn),
          stepFunctionsService.getExecutionHistory(targetArn),
        ]);
        if (executionData) {
          setExecution(executionData);
          setHistory(historyData || []);
          if (executionData.status !== 'RUNNING') {
            clearInterval(interval);
            setPollingInterval(null);
          }
        }
      } catch (err) {
        console.error('Polling error:', err);
      }
    }, 2000);

    setPollingInterval(interval);
  };

  const handleClose = () => {
    if (pollingInterval) clearInterval(pollingInterval);
    if (onClose) onClose();
    else navigate(-1);
  };

  const canRedrive =
    execution?.status === 'FAILED' ||
    execution?.status === 'TIMED_OUT' ||
    execution?.status === 'ABORTED';

  /* ---------- Resize handlers ---------- */

  const handleVResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setResizingV(true);
    const startY = e.clientY;
    const startHeight = topHeight;

    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientY - startY;
      const next = clamp(
        startHeight + delta,
        TOP_HEIGHT_MIN,
        Math.min(TOP_HEIGHT_MAX, window.innerHeight * 0.6)
      );
      setTopHeight(next);
    };
    const onUp = () => {
      setResizingV(false);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const handleHResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setResizingH(true);
    const startX = e.clientX;
    const startWidth = graphWidth;
    const containerWidth =
      splitRef.current?.offsetWidth || window.innerWidth;
    const maxGraphWidth = Math.max(
      GRAPH_WIDTH_MIN_PX,
      containerWidth - STEP_PANEL_MIN_PX - 16
    );

    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      const next = clamp(startWidth + delta, GRAPH_WIDTH_MIN_PX, maxGraphWidth);
      setGraphWidth(next);
    };
    const onUp = () => {
      setResizingH(false);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  // Persist resize values
  useEffect(() => {
    if (!resizingV) {
      try {
        localStorage.setItem(TOP_HEIGHT_KEY, topHeight.toString());
      } catch {
        /* no-op */
      }
    }
  }, [topHeight, resizingV]);

  useEffect(() => {
    if (!resizingH) {
      try {
        localStorage.setItem(GRAPH_WIDTH_KEY, graphWidth.toString());
      } catch {
        /* no-op */
      }
    }
  }, [graphWidth, resizingH]);

  /* ---------- Filters ---------- */

  const filteredEvents = history.filter((event) => {
    if (eventSearchFilter) {
      const s = eventSearchFilter.toLowerCase();
      const matches =
        event.type.toLowerCase().includes(s) ||
        event.id.toString().includes(s) ||
        JSON.stringify(event).toLowerCase().includes(s);
      if (!matches) return false;
    }
    if (eventDateFilter) {
      const eventDate = new Date(event.timestamp).toISOString().split('T')[0];
      if (eventDate !== eventDateFilter) return false;
    }
    if (eventTypeFilter && eventTypeFilter !== 'all') {
      if (
        !event.type.toLowerCase().includes(eventTypeFilter.toLowerCase())
      )
        return false;
    }
    return true;
  });

  const uniqueEventTypes = Array.from(
    new Set(history.map((e) => e.type))
  ).sort();

  /* ---------- Loading / error gates ---------- */

  if (loading && !execution) {
    return (
      <div className="exd-root">
        <div className="exd-body">
          <div className="exd-state">
            <span className="exd-state-spinner" aria-hidden="true" />
            <p className="exd-state-sub">Loading execution…</p>
          </div>
        </div>
      </div>
    );
  }

  if (error && !execution) {
    return (
      <div className="exd-root">
        <div className="exd-body">
          <div className="exd-state">
            <span className="exd-state-icon" aria-hidden="true">
              <AlertIcon />
            </span>
            <h3 className="exd-state-title">Failed to load execution</h3>
            <p className="exd-state-sub">{error}</p>
            <button onClick={handleClose} className="exd-btn">
              Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  const uniqueSteps = getUniqueSteps();
  const stepsWithStatus = uniqueSteps.map((name) => ({
    name,
    status: getStepStatus(name),
    type: getStepType(name),
    duration: getStepDuration(name),
    resource: getStepResource(name),
  }));

  const rootClasses = [
    'exd-root',
    resizingV || resizingH ? 'exd-resizing' : '',
    resizingV ? 'exd-resizing-v' : '',
    resizingH ? 'exd-resizing-h' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={rootClasses}>
      {/* ---------- Top nav ---------- */}
      <nav className="exd-nav">
        <div className="exd-nav-left">
          <button
            type="button"
            className="exd-back"
            onClick={handleClose}
          >
            <ArrowLeftIcon />
            Back
          </button>
          <div className="exd-nav-title">
            <h1 className="exd-name">
              {execution?.name || 'Execution'}
            </h1>
            <ExecutionStatusBadge status={execution?.status} />
          </div>
        </div>

        <div className="exd-nav-right">
          {execution?.status === 'RUNNING' && (
            <button
              type="button"
              className="exd-btn exd-btn--danger"
              onClick={handleStopExecution}
            >
              <StopIcon />
              Stop
            </button>
          )}
          {canRedrive && (
            <button
              type="button"
              className="exd-btn exd-btn--warning"
              onClick={handleRedriveExecution}
              disabled={isRedriving}
            >
              <RedriveIcon />
              {isRedriving ? 'Redriving…' : 'Redrive'}
            </button>
          )}
          <button
            type="button"
            className="exd-btn exd-btn--primary"
            onClick={() => {
              let inputToUse = '{}';
              if (execution?.input) {
                inputToUse = execution.input;
              } else {
                const startEvent = history.find(
                  (e) => e.type === 'ExecutionStarted'
                );
                if (startEvent?.executionStartedEventDetails?.input) {
                  inputToUse = startEvent.executionStartedEventDetails.input;
                }
              }
              setNewExecutionInput(inputToUse);
              setShowNewExecutionModal(true);
            }}
            disabled={!execution?.stateMachineArn}
          >
            <PlayIcon />
            New execution
          </button>
        </div>
      </nav>

      {/* ---------- Body ---------- */}
      <div className="exd-body">
        {/* Top tabs section (resizable height) */}
        <section
          className="exd-top-section"
          style={{ height: topHeight }}
        >
          <div className="exd-section-head">
            <div className="exd-graph-tabs" role="tablist">
              {(
                [
                  { key: 'overview', label: 'Details' },
                  { key: 'input-output', label: 'Input & output' },
                  { key: 'definition', label: 'Definition' },
                  { key: 'events', label: 'Events' },
                ] as Array<{ key: TopTab; label: string }>
              ).map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={activeViewTab === tab.key}
                  className={`exd-graph-tab${
                    activeViewTab === tab.key
                      ? ' exd-graph-tab--active'
                      : ''
                  }`}
                  onClick={() => setActiveViewTab(tab.key)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {activeViewTab === 'overview' && (
            <div className="exd-section-body">
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                  gap: '12px 22px',
                }}
              >
                <div>
                  <span className="exd-info-label">Status</span>
                  <span className="exd-info-value">
                    <ExecutionStatusBadge status={execution?.status} />
                  </span>
                </div>
                <div>
                  <span className="exd-info-label">Execution type</span>
                  <span className="exd-info-value">Standard</span>
                </div>
                <div>
                  <span className="exd-info-label">Start time</span>
                  <span className="exd-info-value">
                    {execution?.startDate
                      ? formatDate(execution.startDate)
                      : '—'}
                  </span>
                </div>
                <div>
                  <span className="exd-info-label">End time</span>
                  <span className="exd-info-value">
                    {execution?.stopDate
                      ? formatDate(execution.stopDate)
                      : '—'}
                  </span>
                </div>
                <div>
                  <span className="exd-info-label">Duration</span>
                  <span className="exd-info-value">
                    {execution?.stopDate && execution?.startDate
                      ? formatDuration(
                          new Date(execution.stopDate).getTime() -
                            new Date(execution.startDate).getTime()
                        )
                      : '—'}
                  </span>
                </div>
                <div>
                  <span className="exd-info-label">Total events</span>
                  <span className="exd-info-value">{history.length}</span>
                </div>
                <div>
                  <span className="exd-info-label">Steps</span>
                  <span className="exd-info-value">{uniqueSteps.length}</span>
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <span className="exd-info-label">
                    State machine ARN
                  </span>
                  <span className="exd-info-value exd-info-mono">
                    {execution?.stateMachineArn || '—'}
                  </span>
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <span className="exd-info-label">Execution ARN</span>
                  <span className="exd-info-value exd-info-mono">
                    {execution?.executionArn || '—'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {activeViewTab === 'input-output' && (
            <div className="exd-section-body">
              <div className="exd-io-grid">
                <div className="exd-io-block">
                  <h4>Execution input</h4>
                  <ExecutionIoBlock
                    kind="input"
                    execution={execution}
                    history={history}
                  />
                </div>
                <div className="exd-io-block">
                  <h4>Execution output</h4>
                  <ExecutionIoBlock
                    kind="output"
                    execution={execution}
                    history={history}
                  />
                </div>
              </div>
            </div>
          )}

          {activeViewTab === 'definition' && (
            <div className="exd-section-body">
              {definitionLoading ? (
                <div className="exd-state">
                  <span
                    className="exd-state-spinner"
                    aria-hidden="true"
                  />
                  <p className="exd-state-sub">
                    Loading state machine definition…
                  </p>
                </div>
              ) : definitionError ? (
                <div className="exd-state">
                  <span className="exd-state-icon" aria-hidden="true">
                    <AlertIcon />
                  </span>
                  <h3 className="exd-state-title">
                    Failed to load definition
                  </h3>
                  <p className="exd-state-sub">{definitionError}</p>
                  <button
                    onClick={() =>
                      execution?.executionArn &&
                      loadStateMachineDefinition(execution.executionArn)
                    }
                    className="exd-btn"
                  >
                    Retry
                  </button>
                </div>
              ) : stateMachineDefinition ? (
                <JsonViewer
                  data={stateMachineDefinition}
                  maxHeight="100%"
                />
              ) : (
                <div className="exd-state">
                  <span className="exd-state-icon" aria-hidden="true">
                    <CodeIcon />
                  </span>
                  <h3 className="exd-state-title">No definition loaded</h3>
                  <p className="exd-state-sub">
                    Click below to load the state machine definition for this
                    execution.
                  </p>
                  <button
                    onClick={() =>
                      execution?.executionArn &&
                      loadStateMachineDefinition(execution.executionArn)
                    }
                    className="exd-btn exd-btn--primary"
                  >
                    Load definition
                  </button>
                </div>
              )}
            </div>
          )}

          {activeViewTab === 'events' && (
            <>
              <div className="exd-events-filters">
                <input
                  type="text"
                  placeholder="Filter events…"
                  value={eventSearchFilter}
                  onChange={(e) => setEventSearchFilter(e.target.value)}
                  className="exd-filter-input"
                />
                <input
                  type="date"
                  value={eventDateFilter}
                  onChange={(e) => setEventDateFilter(e.target.value)}
                  className="exd-filter-date"
                />
                <select
                  value={eventTypeFilter}
                  onChange={(e) => setEventTypeFilter(e.target.value)}
                  className="exd-filter-select"
                >
                  <option value="">All types</option>
                  {uniqueEventTypes.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </div>
              <div className="exd-table-wrap">
                <table className="exd-table">
                  <thead>
                    <tr>
                      <th></th>
                      <th>ID</th>
                      <th>Type</th>
                      <th>Step</th>
                      <th>Timestamp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEvents.map((event) => (
                      <EventRow
                        key={event.id}
                        event={event}
                        formatDate={formatDate}
                        showStepCol
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>

        {/* ---------- Vertical resize handle ---------- */}
        <div
          className={`exd-resize-v${
            resizingV ? ' exd-resize--active' : ''
          }`}
          onMouseDown={handleVResizeMouseDown}
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize top panel"
        />

        {/* ---------- Bottom split ---------- */}
        <div className="exd-split" ref={splitRef}>
          {/* Graph panel (left) */}
          <section
            className="exd-graph-panel"
            style={{ width: graphWidth }}
          >
            <div className="exd-section-head">
              <h3 className="exd-section-title">Workflow</h3>
              <div className="exd-graph-tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeGraphTab === 'graph'}
                  className={`exd-graph-tab${
                    activeGraphTab === 'graph'
                      ? ' exd-graph-tab--active'
                      : ''
                  }`}
                  onClick={() => setActiveGraphTab('graph')}
                >
                  Graph
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeGraphTab === 'table'}
                  className={`exd-graph-tab${
                    activeGraphTab === 'table'
                      ? ' exd-graph-tab--active'
                      : ''
                  }`}
                  onClick={() => setActiveGraphTab('table')}
                >
                  Table
                </button>
              </div>
            </div>

            <div className="exd-flow-legend">
              <span className="exd-legend-item">
                <span
                  className="exd-legend-dot"
                  style={{ background: '#10b981' }}
                />
                Succeeded
              </span>
              <span className="exd-legend-item">
                <span
                  className="exd-legend-dot"
                  style={{ background: '#ef4444' }}
                />
                Failed
              </span>
              <span className="exd-legend-item">
                <span
                  className="exd-legend-dot"
                  style={{ background: '#3b82f6' }}
                />
                Running
              </span>
              <span className="exd-legend-item">
                <span
                  className="exd-legend-dot"
                  style={{ background: '#94a3b8' }}
                />
                Pending
              </span>
            </div>

            {activeGraphTab === 'graph' ? (
              <div className="exd-flow">
                {stepsWithStatus.length > 0 ? (
                  <>
                    <FlowTerminal
                      kind="start"
                      label="Start"
                      hasArrow={stepsWithStatus.length > 0}
                    />

                    {stepsWithStatus.map((step) => (
                      <React.Fragment key={step.name}>
                        <FlowNode
                          step={step}
                          isSelected={selectedStep === step.name}
                          onSelect={() => setSelectedStep(step.name)}
                        />
                        <span
                          className="exd-flow-arrow"
                          aria-hidden="true"
                        />
                      </React.Fragment>
                    ))}

                    <FlowTerminal
                      kind="end"
                      label="End"
                      executionStatus={execution?.status}
                    />
                  </>
                ) : (
                  <div className="exd-flow-empty">
                    <span className="exd-state-icon" aria-hidden="true">
                      <CodeIcon />
                    </span>
                    <h3 className="exd-state-title">No steps</h3>
                    <p className="exd-state-sub">
                      This execution doesn't have any step events yet.
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="exd-table-wrap">
                <table className="exd-table">
                  <thead>
                    <tr>
                      <th>Step</th>
                      <th>Type</th>
                      <th>Status</th>
                      <th>Duration</th>
                      <th>Resource</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stepsWithStatus.length > 0 ? (
                      stepsWithStatus.map((step) => (
                        <tr
                          key={step.name}
                          className={
                            selectedStep === step.name
                              ? 'exd-row--selected'
                              : undefined
                          }
                          onClick={() => setSelectedStep(step.name)}
                        >
                          <td>
                            <div className="exd-step-name-cell">
                              <span
                                className={`exd-step-name-cell-icon exd-step-name-cell-icon--${step.status}`}
                              >
                                {step.status === 'succeeded'
                                  ? ''
                                  : step.status === 'failed'
                                  ? ''
                                  : step.status === 'running'
                                  ? '•'
                                  : '○'}
                              </span>
                              {step.name}
                            </div>
                          </td>
                          <td>{step.type}</td>
                          <td>
                            <StepStatusBadge status={step.status} />
                          </td>
                          <td>{step.duration}</td>
                          <td>
                            <span
                              className="exd-resource-text"
                              title={step.resource}
                            >
                              {step.resource || '—'}
                            </span>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td
                          colSpan={5}
                          style={{
                            textAlign: 'center',
                            color: 'var(--exd-text-muted)',
                          }}
                        >
                          No steps found
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Horizontal resize handle */}
          <div
            className={`exd-resize-h${
              resizingH ? ' exd-resize--active' : ''
            }`}
            onMouseDown={handleHResizeMouseDown}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize graph panel"
          />

          {/* Step details (right) */}
          <div className="exd-step-panel-wrap">
            {selectedStep ? (
              <div className="exd-step-panel">
                <div className="exd-step-panel-head">
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <h3 className="exd-step-panel-title">
                      {selectedStep}
                    </h3>
                    {getStepResource(selectedStep) && (
                      <div className="exd-step-panel-resource">
                        {getStepResource(selectedStep)}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    className="exd-btn exd-btn--sm"
                    onClick={() => setSelectedStep(null)}
                  >
                    ← Back
                  </button>
                </div>

                <div className="exd-step-panel-tabs" role="tablist">
                  {(
                    [
                      { key: 'input-output', label: 'Input / output' },
                      { key: 'details', label: 'Details' },
                      { key: 'definition', label: 'Definition' },
                      { key: 'events', label: 'Events' },
                    ] as Array<{ key: StepTab; label: string }>
                  ).map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      role="tab"
                      aria-selected={activeStepTab === tab.key}
                      className={`exd-step-panel-tab${
                        activeStepTab === tab.key
                          ? ' exd-step-panel-tab--active'
                          : ''
                      }`}
                      onClick={() => setActiveStepTab(tab.key)}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                <div className="exd-step-panel-body">
                  {activeStepTab === 'input-output' && (
                    <div style={{ display: 'grid', gap: 14 }}>
                      <div className="exd-io-block">
                        <h4>Input</h4>
                        <JsonViewer
                          data={getStepInput(selectedStep)}
                          maxHeight="220px"
                        />
                      </div>
                      <div className="exd-io-block">
                        <h4>Output</h4>
                        <JsonViewer
                          data={getStepOutput(selectedStep)}
                          maxHeight="220px"
                        />
                      </div>
                    </div>
                  )}

                  {activeStepTab === 'details' && (
                    <div className="exd-detail-list">
                      <div>
                        <span className="exd-info-label">Step name</span>
                        <span className="exd-info-value">
                          {selectedStep}
                        </span>
                      </div>
                      <div>
                        <span className="exd-info-label">Type</span>
                        <span className="exd-info-value">
                          {getStepType(selectedStep)}
                        </span>
                      </div>
                      <div>
                        <span className="exd-info-label">Status</span>
                        <span className="exd-info-value">
                          <StepStatusBadge
                            status={getStepStatus(selectedStep)}
                          />
                        </span>
                      </div>
                      <div>
                        <span className="exd-info-label">Duration</span>
                        <span className="exd-info-value">
                          {getStepDuration(selectedStep)}
                        </span>
                      </div>
                      <div style={{ gridColumn: '1 / -1' }}>
                        <span className="exd-info-label">Resource</span>
                        <span className="exd-info-value exd-info-mono">
                          {getStepResource(selectedStep) || '—'}
                        </span>
                      </div>
                    </div>
                  )}

                  {activeStepTab === 'definition' && (
                    <>
                      {stateMachineDefinition ? (
                        getStepDefinition(selectedStep) ? (
                          <JsonViewer
                            data={getStepDefinition(selectedStep)}
                            maxHeight="100%"
                          />
                        ) : (
                          <div className="exd-no-data">
                            No definition found for "{selectedStep}".
                          </div>
                        )
                      ) : (
                        <div className="exd-no-data">
                          State machine definition not loaded. Open the
                          "Definition" tab above to load it.
                        </div>
                      )}
                    </>
                  )}

                  {activeStepTab === 'events' && (
                    <div className="exd-table-wrap">
                      <table className="exd-table">
                        <thead>
                          <tr>
                            <th></th>
                            <th>ID</th>
                            <th>Type</th>
                            <th>Timestamp</th>
                          </tr>
                        </thead>
                        <tbody>
                          {getStepEvents(selectedStep).length === 0 ? (
                            <tr>
                              <td
                                colSpan={4}
                                style={{
                                  textAlign: 'center',
                                  color: 'var(--exd-text-muted)',
                                }}
                              >
                                No events found for this step.
                              </td>
                            </tr>
                          ) : (
                            getStepEvents(selectedStep).map((event) => (
                              <EventRow
                                key={event.id}
                                event={event}
                                formatDate={formatDate}
                              />
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="exd-empty-panel">
                <span className="exd-empty-panel-icon" aria-hidden="true">
                  <PointerIcon />
                </span>
                <h3 className="exd-empty-panel-title">Select a step</h3>
                <p className="exd-state-sub">
                  Pick a step in the workflow to inspect its input, output,
                  events, and definition.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ---------- New execution modal ---------- */}
      {showNewExecutionModal && (
        <div
          className="exd-modal-overlay"
          onClick={() => setShowNewExecutionModal(false)}
        >
          <div className="exd-modal" onClick={(e) => e.stopPropagation()}>
            <div className="exd-modal-head">
              <h3 className="exd-modal-title">Start new execution</h3>
              <button
                type="button"
                className="exd-modal-close"
                onClick={() => setShowNewExecutionModal(false)}
                aria-label="Close"
              >
                
              </button>
            </div>
            <div className="exd-modal-body">
              <div className="exd-modal-field">
                <span className="exd-modal-label">State machine</span>
                <div className="exd-modal-arn">
                  {execution?.stateMachineArn || '—'}
                </div>
              </div>
              <div className="exd-modal-field">
                <label
                  className="exd-modal-label"
                  htmlFor="exd-input"
                >
                  Input (JSON)
                </label>
                <textarea
                  id="exd-input"
                  className="exd-modal-textarea"
                  value={newExecutionInput}
                  onChange={(e) => setNewExecutionInput(e.target.value)}
                  placeholder='{"key": "value"}'
                  rows={10}
                />
              </div>
            </div>
            <div className="exd-modal-foot">
              <button
                type="button"
                className="exd-btn"
                onClick={() => setShowNewExecutionModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="exd-btn exd-btn--primary"
                onClick={handleNewExecution}
                disabled={isStartingExecution}
              >
                {isStartingExecution ? 'Starting…' : 'Start execution'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ExecutionDetails;

/* ============================================================
 * Helpers + small components
 * ========================================================== */

function clamp(n: number, min: number, max: number) {
  return Math.min(Math.max(n, min), max);
}

interface FlowNodeProps {
  step: { name: string; status: StepStatus; type: string; duration: string };
  isSelected: boolean;
  onSelect: () => void;
}

function FlowNode({ step, isSelected, onSelect }: FlowNodeProps) {
  return (
    <button
      type="button"
      className={`exd-flow-node exd-flow-node--${step.status}${
        isSelected ? ' exd-flow-node--selected' : ''
      }`}
      onClick={onSelect}
    >
      <div className="exd-flow-node-row">
        <span className="exd-flow-node-name" title={step.name}>
          {step.name}
        </span>
        <span className="exd-flow-node-type">{step.type}</span>
      </div>
      <div className="exd-flow-node-meta">
        <span className="exd-flow-node-status">
          <span
            className={`exd-flow-status-dot exd-flow-status-dot--${step.status}`}
          />
          {step.status}
        </span>
        <span>{step.duration}</span>
      </div>
    </button>
  );
}

function FlowTerminal({
  kind,
  label,
  executionStatus,
  hasArrow = true,
}: {
  kind: 'start' | 'end';
  label: string;
  executionStatus?: string;
  hasArrow?: boolean;
}) {
  let endVariant = 'end';
  if (kind === 'end') {
    if (executionStatus === 'SUCCEEDED') endVariant = 'end-success';
    else if (
      executionStatus === 'FAILED' ||
      executionStatus === 'TIMED_OUT' ||
      executionStatus === 'ABORTED'
    )
      endVariant = 'end-failed';
  }
  const className =
    kind === 'start'
      ? 'exd-flow-terminal exd-flow-terminal--start'
      : `exd-flow-terminal exd-flow-terminal--${endVariant}`;
  return (
    <>
      {kind === 'end' ? null : null}
      <span className={className}>{label}</span>
      {kind === 'start' && hasArrow && (
        <span className="exd-flow-arrow" aria-hidden="true" />
      )}
    </>
  );
}

function ExecutionStatusBadge({ status }: { status?: string }) {
  if (!status) {
    return (
      <span className="exd-badge exd-badge--default">UNKNOWN</span>
    );
  }
  const variant =
    status === 'SUCCEEDED'
      ? 'succeeded'
      : status === 'FAILED'
      ? 'failed'
      : status === 'RUNNING'
      ? 'running'
      : status === 'TIMED_OUT'
      ? 'timed-out'
      : status === 'ABORTED' ||
        status === 'STOPPED' ||
        status === 'CANCELLED'
      ? 'aborted'
      : 'default';
  return (
    <span className={`exd-badge exd-badge--${variant}`}>{status}</span>
  );
}

function StepStatusBadge({ status }: { status: string }) {
  const variant =
    status === 'succeeded'
      ? 'succeeded'
      : status === 'failed'
      ? 'failed'
      : status === 'running'
      ? 'running'
      : 'pending';
  return (
    <span className={`exd-badge exd-badge--${variant}`}>{status}</span>
  );
}

interface ExecutionIoBlockProps {
  kind: 'input' | 'output';
  execution: StepFunctionExecution | null;
  history: ExecutionHistoryEvent[];
}

function ExecutionIoBlock({ kind, execution, history }: ExecutionIoBlockProps) {
  if (kind === 'input') {
    const startEvent = history.find((e) => e.type === 'ExecutionStarted');
    const inputData =
      startEvent?.executionStartedEventDetails?.input || execution?.input;
    if (!inputData) {
      return <div className="exd-no-data">No input provided.</div>;
    }
    try {
      const parsed =
        typeof inputData === 'string' ? JSON.parse(inputData) : inputData;
      return <JsonViewer data={parsed} maxHeight="220px" />;
    } catch {
      return (
        <div className="exd-no-data exd-no-data--error">
          Invalid JSON input. Raw: {String(inputData)}
        </div>
      );
    }
  }

  const endEvent = history.find(
    (e) => e.type === 'ExecutionSucceeded' || e.type === 'ExecutionFailed'
  );
  let outputData: any;
  if (
    endEvent?.type === 'ExecutionSucceeded' &&
    endEvent.executionSucceededEventDetails?.output
  ) {
    outputData = endEvent.executionSucceededEventDetails.output;
  } else if (
    endEvent?.type === 'ExecutionFailed' &&
    endEvent.executionFailedEventDetails?.error
  ) {
    outputData = {
      error: endEvent.executionFailedEventDetails.error,
      cause: endEvent.executionFailedEventDetails.cause,
    };
  } else {
    outputData = execution?.output;
  }

  if (outputData) {
    try {
      const parsed =
        typeof outputData === 'string' ? JSON.parse(outputData) : outputData;
      const isError = endEvent?.type === 'ExecutionFailed';
      return <JsonViewer data={parsed} isError={isError} maxHeight="220px" />;
    } catch {
      return (
        <div className="exd-no-data">Raw: {String(outputData)}</div>
      );
    }
  }

  if (execution?.status === 'FAILED') {
    return (
      <div className="exd-no-data exd-no-data--error">
        Execution failed — no output available.
      </div>
    );
  }
  if (execution?.status === 'RUNNING') {
    return (
      <div className="exd-no-data">
        Execution still running — output not yet available.
      </div>
    );
  }
  return <div className="exd-no-data">No output available.</div>;
}

/* ---------- Inline icons ---------- */

function ArrowLeftIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <polygon points="6 4 20 12 6 20" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <rect x="5" y="5" width="14" height="14" rx="1" />
    </svg>
  );
}

function RedriveIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </svg>
  );
}

function CodeIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  );
}

function PointerIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 11.24V7.5a2.5 2.5 0 0 1 5 0V12" />
      <path d="M14 10.5a2.5 2.5 0 0 1 5 0V14a8 8 0 0 1-8 8h-2c-2 0-3.5-.5-4.5-2L2 13c-.5-1 .5-2 1.5-2L7 13" />
    </svg>
  );
}

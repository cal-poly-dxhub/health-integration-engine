import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { stepFunctionsService, ExecutionHistoryEvent, StepFunctionExecution } from '../../services/stepFunctions';
import './ExecutionDetails.css';
import { error } from 'console';
import { ms } from 'zod/v4/locales';



interface ExecutionDetailsProps {
  execution?: StepFunctionExecution;
  onClose?: () => void;
}

// Removed unused StepState interface

interface EventRowProps {
  event: ExecutionHistoryEvent;
  formatDate: (dateString: string) => string;
  formatDuration: (ms: number) => string;
  allEvents: ExecutionHistoryEvent[];
}

interface StepEventRowProps {
  event: ExecutionHistoryEvent;
  formatDate: (dateString: string) => string;
  formatDuration: (ms: number) => string;
}

interface EventDetailsViewerProps {
  event: ExecutionHistoryEvent;
}

// Enhanced JSON Viewer Component with AWS Step Functions styling
interface JsonViewerProps {
  data: any;
  isError?: boolean;
  maxHeight?: string;
  showLineNumbers?: boolean;
}

const JsonViewer: React.FC<JsonViewerProps> = ({
  data,
  isError = false,
  maxHeight = '300px',
  showLineNumbers = false
}) => {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set(['root']));

  const togglePath = (path: string) => {
    const newExpanded = new Set(expandedPaths);
    if (newExpanded.has(path)) {
      newExpanded.delete(path);
    } else {
      newExpanded.add(path);
    }
    setExpandedPaths(newExpanded);
  };

  const renderJsonValue = (value: any, path: string = 'root', depth: number = 0, key?: string): React.ReactNode => {
    const indent = '  '.repeat(depth);

    if (value === null) {
      return (
        <div className="json-line" key={path}>
          <span className="json-indent">{indent}</span>
          {key && <><span className="json-key">"{key}"</span><span className="json-colon">: </span></>}
          <span className="json-null">null</span>
        </div>
      );
    }

    if (value === undefined) {
      return (
        <div className="json-line" key={path}>
          <span className="json-indent">{indent}</span>
          {key && <><span className="json-key">"{key}"</span><span className="json-colon">: </span></>}
          <span className="json-undefined">undefined</span>
        </div>
      );
    }

    if (typeof value === 'string') {
      const isErrorString = isError && (key === 'error' || key === 'errorMessage' || key === 'cause');
      return (
        <div className="json-line" key={path}>
          <span className="json-indent">{indent}</span>
          {key && <><span className="json-key">"{key}"</span><span className="json-colon">: </span></>}
          <span className={isErrorString ? "json-error-string" : "json-string"}>"{value}"</span>
        </div>
      );
    }

    if (typeof value === 'number') {
      return (
        <div className="json-line" key={path}>
          <span className="json-indent">{indent}</span>
          {key && <><span className="json-key">"{key}"</span><span className="json-colon">: </span></>}
          <span className="json-number">{value}</span>
        </div>
      );
    }

    if (typeof value === 'boolean') {
      return (
        <div className="json-line" key={path}>
          <span className="json-indent">{indent}</span>
          {key && <><span className="json-key">"{key}"</span><span className="json-colon">: </span></>}
          <span className="json-boolean">{value.toString()}</span>
        </div>
      );
    }

    if (Array.isArray(value)) {
      if (value.length === 0) {
        return (
          <div className="json-line" key={path}>
            <span className="json-indent">{indent}</span>
            {key && <><span className="json-key">"{key}"</span><span className="json-colon">: </span></>}
            <span className="json-bracket">[]</span>
          </div>
        );
      }

      const isExpanded = expandedPaths.has(path);
      return (
        <React.Fragment key={path}>
          <div className="json-line">
            <span className="json-indent">{indent}</span>
            {key && <><span className="json-key">"{key}"</span><span className="json-colon">: </span></>}
            <span
              className="json-toggle"
              onClick={() => togglePath(path)}
            >
              <span className={`json-arrow ${isExpanded ? 'expanded' : ''}`}>▶</span>
              <span className="json-bracket">[</span>
              {!isExpanded && <span className="json-ellipsis">...{value.length} items</span>}
            </span>
            {!isExpanded && <span className="json-bracket">]</span>}
          </div>
          {isExpanded && (
            <>
              {value.map((item, index) =>
                renderJsonValue(item, `${path}[${index}]`, depth + 1, index.toString())
              )}
              <div className="json-line">
                <span className="json-indent">{indent}</span>
                <span className="json-bracket">]</span>
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
          <div className="json-line" key={path}>
            <span className="json-indent">{indent}</span>
            {key && <><span className="json-key">"{key}"</span><span className="json-colon">: </span></>}
            <span className="json-brace">{'{}'}</span>
          </div>
        );
      }

      const isExpanded = expandedPaths.has(path);
      return (
        <React.Fragment key={path}>
          <div className="json-line">
            <span className="json-indent">{indent}</span>
            {key && <><span className="json-key">"{key}"</span><span className="json-colon">: </span></>}
            <span
              className="json-toggle"
              onClick={() => togglePath(path)}
            >
              <span className={`json-arrow ${isExpanded ? 'expanded' : ''}`}>▶</span>
              <span className="json-brace">{'{'}</span>
              {!isExpanded && <span className="json-ellipsis">...{keys.length} keys</span>}
            </span>
            {!isExpanded && <span className="json-brace">{'}'}</span>}
          </div>
          {isExpanded && (
            <>
              {keys.map(objKey =>
                renderJsonValue(value[objKey], `${path}.${objKey}`, depth + 1, objKey)
              )}
              <div className="json-line">
                <span className="json-indent">{indent}</span>
                <span className="json-brace">{'}'}</span>
              </div>
            </>
          )}
        </React.Fragment>
      );
    }

    return (
      <div className="json-line" key={path}>
        <span className="json-indent">{indent}</span>
        {key && <><span className="json-key">"{key}"</span><span className="json-colon">: </span></>}
        <span className="json-unknown">{String(value)}</span>
      </div>
    );
  };

  if (data === null || data === undefined) {
    return (
      <div className={`aws-json-viewer ${isError ? 'error-viewer' : ''}`} style={{ maxHeight }}>
        <div className="json-line">
          <span className="json-null">{data === null ? 'null' : 'undefined'}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`aws-json-viewer ${isError ? 'error-viewer' : ''}`} style={{ maxHeight }}>
      {renderJsonValue(data)}
    </div>
  );
};

const EventDetailsViewer: React.FC<EventDetailsViewerProps> = ({ event }) => {
  const getEventDetails = () => {
    if (event.stateEnteredEventDetails) return event.stateEnteredEventDetails;
    if (event.stateExitedEventDetails) return event.stateExitedEventDetails;
    if (event.taskStateEnteredEventDetails) return event.taskStateEnteredEventDetails;
    if (event.taskFailedEventDetails) return event.taskFailedEventDetails;
    if (event.taskSucceededEventDetails) return event.taskSucceededEventDetails;
    if (event.executionFailedEventDetails) return event.executionFailedEventDetails;
    if (event.executionSucceededEventDetails) return event.executionSucceededEventDetails;
    return null;
  };

  const details = getEventDetails();
  if (!details) return null;

  const isErrorEvent = event.type.toLowerCase().includes('failed') || event.type.toLowerCase().includes('error');

  return (
    <div className="event-details-viewer">
      <h4>Event Details</h4>
      <JsonViewer data={details} isError={isErrorEvent} maxHeight="250px" />
    </div>
  );
};

interface TopPanelEventRowProps {
  event: ExecutionHistoryEvent;
  formatDate: (dateString: string) => string;
}

const TopPanelEventRow: React.FC<TopPanelEventRowProps> = ({ event, formatDate }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const getStepName = () => {
    if (event.stateEnteredEventDetails?.name) return event.stateEnteredEventDetails.name;
    if (event.stateExitedEventDetails?.name) return event.stateExitedEventDetails.name;
    if (event.taskStateEnteredEventDetails?.name) return event.taskStateEnteredEventDetails.name;
    if (event.type.includes('Execution')) return 'Execution';
    return '-';
  };

  const getEventDetails = () => {
    // Return only the relevant event details, not the entire event object
    if (event.taskScheduledEventDetails) return event.taskScheduledEventDetails;
    if (event.stateEnteredEventDetails) return event.stateEnteredEventDetails;
    if (event.stateExitedEventDetails) return event.stateExitedEventDetails;
    if (event.taskStateEnteredEventDetails) return event.taskStateEnteredEventDetails;
    if (event.taskSucceededEventDetails) return event.taskSucceededEventDetails;
    if (event.taskFailedEventDetails) return event.taskFailedEventDetails;
    if (event.lambdaFunctionSucceededEventDetails) return event.lambdaFunctionSucceededEventDetails;
    if (event.lambdaFunctionFailedEventDetails) return event.lambdaFunctionFailedEventDetails;
    if (event.executionStartedEventDetails) return event.executionStartedEventDetails;
    if (event.executionSucceededEventDetails) return event.executionSucceededEventDetails;
    if (event.executionFailedEventDetails) return event.executionFailedEventDetails;

    // If no specific details, return basic event info
    return {
      eventId: event.id,
      eventType: event.type,
      timestamp: event.timestamp,
      previousEventId: event.previousEventId
    };
  };

  const handleRowClick = (e: React.MouseEvent) => {
    // Prevent expansion when clicking on buttons or interactive elements
    if ((e.target as HTMLElement).closest('.event-actions')) {
      return;
    }
    setIsExpanded(!isExpanded);
  };

  return (
    <>
      <tr className="full-event-row" onClick={handleRowClick}>
        <td className="expand-col">
          <span className={`expand-arrow ${isExpanded ? 'expanded' : ''}`}>▶</span>
        </td>
        <td>{event.id}</td>
        <td>
          <span className="event-type-full">
            <span className="event-icon" style={{ 
              color: event.type.includes('Failed') ? '#dc3545' : 
                     event.type.includes('Succeeded') ? '#28a745' : 
                     event.type.includes('Started') || event.type.includes('Entered') ? '#007bff' : '#6c757d'
            }}>
              {event.type.includes('Failed') ? '✗' :
               event.type.includes('Succeeded') ? '✓' :
               event.type.includes('Started') || event.type.includes('Entered') ? '▶' :
               event.type.includes('Exited') ? '←' : '●'}
            </span>
            <span className="event-type-text">{event.type}</span>
          </span>
        </td>
        <td>
          <span className="step-name-text">{getStepName()}</span>
        </td>
        <td>
          <span className="timestamp-text">{formatDate(event.timestamp)}</span>
        </td>
      </tr>

      {isExpanded && (
        <tr className="top-panel-event-details-row">
          <td colSpan={5}>
            <div className="top-panel-event-details">
              <div className="event-details-header">
                <h5>Event Details</h5>
              </div>
              <div className="event-details-json">
                <JsonViewer data={getEventDetails()} maxHeight="200px" />
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
};

const StepEventRow: React.FC<StepEventRowProps> = ({ event, formatDate, formatDuration }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const getEventIcon = (type: string) => {
    if (type.includes('Failed')) return '✗';
    if (type.includes('Succeeded')) return '✓';
    if (type.includes('Started')) return '▶';
    if (type.includes('Entered')) return '→';
    if (type.includes('Exited')) return '←';
    if (type.includes('Execution')) return '⚡';
    if (type.includes('Task')) return '⚙';
    if (type.includes('Choice')) return '◊';
    if (type.includes('Parallel')) return '⫸';
    if (type.includes('Map')) return '⊞';
    if (type.includes('Wait')) return '⏱';
    if (type.includes('Pass')) return '→';
    if (type.includes('Lambda')) return 'λ';
    return '●';
  };

  const getEventColor = (type: string) => {
    if (type.includes('Failed')) return '#dc3545'; // AWS red for failures
    if (type.includes('Succeeded')) return '#28a745'; // AWS green for success
    if (type.includes('Started') || type.includes('Entered')) return '#007bff'; // AWS blue for running/active
    if (type.includes('Exited')) return '#6c757d'; // AWS gray for completed
    return '#6c757d'; // Default AWS gray
  };

  const getEventDetails = () => {
    // Return only the relevant event details, not the entire event object
    if (event.taskScheduledEventDetails) return event.taskScheduledEventDetails;
    if (event.stateEnteredEventDetails) return event.stateEnteredEventDetails;
    if (event.stateExitedEventDetails) return event.stateExitedEventDetails;
    if (event.taskStateEnteredEventDetails) return event.taskStateEnteredEventDetails;
    if (event.taskSucceededEventDetails) return event.taskSucceededEventDetails;
    if (event.taskFailedEventDetails) return event.taskFailedEventDetails;
    if (event.lambdaFunctionSucceededEventDetails) return event.lambdaFunctionSucceededEventDetails;
    if (event.lambdaFunctionFailedEventDetails) return event.lambdaFunctionFailedEventDetails;
    if (event.executionStartedEventDetails) return event.executionStartedEventDetails;
    if (event.executionSucceededEventDetails) return event.executionSucceededEventDetails;
    if (event.executionFailedEventDetails) return event.executionFailedEventDetails;

    // If no specific details, return basic event info
    return {
      eventId: event.id,
      eventType: event.type,
      timestamp: event.timestamp,
      previousEventId: event.previousEventId
    };
  };

  const handleRowClick = (e: React.MouseEvent) => {
    // Prevent expansion when clicking on buttons or interactive elements
    if ((e.target as HTMLElement).closest('.event-actions')) {
      return;
    }
    setIsExpanded(!isExpanded);
  };

  return (
    <>
      <tr className="step-event-row" onClick={handleRowClick} data-event-type={event.type}>
        <td className="step-events-expand-col">
          <span className={`expand-arrow ${isExpanded ? 'expanded' : ''}`}>▶</span>
        </td>
        <td className="step-events-id-col">{event.id}</td>
        <td className="step-events-type-col">
          <div className="event-type-container">
            <span className="event-icon" style={{ color: getEventColor(event.type) }}>
              {getEventIcon(event.type)}
            </span>
            <span className="event-type-text">
              {event.type}
            </span>
          </div>
        </td>
        <td className="step-events-timestamp-col">
          <span className="timestamp-text">{formatDate(event.timestamp)}</span>
        </td>
      </tr>

      {isExpanded && (
        <tr className="step-event-details-row">
          <td colSpan={4}>
            <div className="step-event-details-simple">
              <div className="step-event-summary">
                <table className="step-event-details-table">
                  <thead>
                    <tr>
                      <th>Event ID</th>
                      <th>Type</th>
                      <th>Timestamp</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>{event.id}</td>
                      <td>{event.type}</td>
                      <td>{formatDate(event.timestamp)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="step-event-raw-details">
                <h5>Event Details</h5>
                <JsonViewer data={getEventDetails()} maxHeight="300px" />
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
};

const EventRow: React.FC<EventRowProps> = ({ event, formatDate, formatDuration, allEvents }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const getEventIcon = (type: string) => {
    if (type.includes('Failed')) return '✗';
    if (type.includes('Succeeded')) return '✓';
    if (type.includes('Started')) return '▶';
    if (type.includes('Entered')) return '→';
    if (type.includes('Exited')) return '←';
    if (type.includes('Execution')) return '⚡';
    if (type.includes('Task')) return '⚙';
    if (type.includes('Choice')) return '◊';
    if (type.includes('Parallel')) return '⫸';
    if (type.includes('Map')) return '⊞';
    if (type.includes('Wait')) return '⏱';
    if (type.includes('Pass')) return '→';
    if (type.includes('Lambda')) return 'λ';
    return '●';
  };

  const getEventColor = (type: string) => {
    if (type.includes('Failed')) return '#dc3545'; // AWS red for failures
    if (type.includes('Succeeded')) return '#28a745'; // AWS green for success
    if (type.includes('Started') || type.includes('Entered')) return '#007bff'; // AWS blue for running/active
    if (type.includes('Exited')) return '#6c757d'; // AWS gray for completed
    return '#6c757d'; // Default AWS gray
  };

  const getStepName = () => {
    // Extract step name from various event details - AWS console shows actual state names
    if (event.stateEnteredEventDetails?.name) return event.stateEnteredEventDetails.name;
    if (event.stateExitedEventDetails?.name) return event.stateExitedEventDetails.name;
    if (event.taskStateEnteredEventDetails?.name) return event.taskStateEnteredEventDetails.name;

    // For task events, try to find the related state name from previous events
    if (event.type.includes('Task')) {
      // Look for the most recent TaskStateEntered or StateEntered event
      const relatedStateEvent = allEvents
        .slice(0, event.id)
        .reverse()
        .find(e =>
          (e.type === 'TaskStateEntered' && e.taskStateEnteredEventDetails?.name) ||
          (e.type === 'StateEntered' && e.stateEnteredEventDetails?.name)
        );

      if (relatedStateEvent) {
        if (relatedStateEvent.taskStateEnteredEventDetails?.name) {
          return relatedStateEvent.taskStateEnteredEventDetails.name;
        }
        if (relatedStateEvent.stateEnteredEventDetails?.name) {
          return relatedStateEvent.stateEnteredEventDetails.name;
        }
      }
    }

    // For Lambda events, find the related state
    if (event.type.includes('Lambda')) {
      const relatedStateEvent = allEvents
        .slice(0, event.id)
        .reverse()
        .find(e =>
          (e.type === 'TaskStateEntered' && e.taskStateEnteredEventDetails?.name) ||
          (e.type === 'StateEntered' && e.stateEnteredEventDetails?.name)
        );

      if (relatedStateEvent) {
        if (relatedStateEvent.taskStateEnteredEventDetails?.name) {
          return relatedStateEvent.taskStateEnteredEventDetails.name;
        }
        if (relatedStateEvent.stateEnteredEventDetails?.name) {
          return relatedStateEvent.stateEnteredEventDetails.name;
        }
      }
    }

    // For Pass events, find the related state
    if (event.type.includes('Pass')) {
      const relatedStateEvent = allEvents
        .slice(0, event.id)
        .reverse()
        .find(e =>
          (e.type === 'StateEntered' && e.stateEnteredEventDetails?.name)
        );

      if (relatedStateEvent?.stateEnteredEventDetails?.name) {
        return relatedStateEvent.stateEnteredEventDetails.name;
      }
    }

    // For execution events, show "Execution"
    if (event.type.includes('Execution')) return 'Execution';

    // Default fallback - try to find any recent state
    const anyRecentState = allEvents
      .slice(0, event.id)
      .reverse()
      .find(e =>
        (e.type === 'TaskStateEntered' && e.taskStateEnteredEventDetails?.name) ||
        (e.type === 'StateEntered' && e.stateEnteredEventDetails?.name)
      );

    if (anyRecentState) {
      if (anyRecentState.taskStateEnteredEventDetails?.name) {
        return anyRecentState.taskStateEnteredEventDetails.name;
      }
      if (anyRecentState.stateEnteredEventDetails?.name) {
        return anyRecentState.stateEnteredEventDetails.name;
      }
    }

    return '-';
  };

  const getResourceName = () => {
    // For TaskScheduled events, show the resource using resourceType and resource fields
    if (event.taskScheduledEventDetails) {
      const { resourceType, resource } = event.taskScheduledEventDetails;

      if (resourceType && resource) {
        return `${resourceType}:${resource}`;
      }

      // Fallback to the full resource field if resourceType is not available
      if (event.taskScheduledEventDetails.resource) {
        const fullResource = event.taskScheduledEventDetails.resource;

        // AWS SDK calls - show as aws-sdk:service:operation
        if (fullResource.includes('arn:aws:states:::aws-sdk:')) {
          return fullResource.replace('arn:aws:states:::', '');
        }

        // Lambda function calls - show as "Lambda Function: functionName"
        if (fullResource.includes('lambda:invoke')) {
          const match = fullResource.match(/function:([^:]+)/);
          if (match) return `Lambda Function: ${match[1]}`;
        }

        return fullResource;
      }
    }

    // For task execution events (Started, Succeeded, Failed), find the related TaskScheduled event
    if (event.type.includes('Task') && !event.type.includes('TaskScheduled')) {
      // Look backwards for the most recent TaskScheduled event
      const taskScheduledEvent = allEvents
        .slice(0, event.id)
        .reverse()
        .find(e => e.type === 'TaskScheduled' && e.taskScheduledEventDetails);

      if (taskScheduledEvent?.taskScheduledEventDetails) {
        const { resourceType, resource } = taskScheduledEvent.taskScheduledEventDetails;

        if (resourceType && resource) {
          return `${resourceType}:${resource}`;
        }

        // Fallback to full resource field
        if (taskScheduledEvent.taskScheduledEventDetails.resource) {
          const fullResource = taskScheduledEvent.taskScheduledEventDetails.resource;

          // AWS SDK calls
          if (fullResource.includes('arn:aws:states:::aws-sdk:')) {
            return fullResource.replace('arn:aws:states:::', '');
          }

          // Lambda function calls
          if (fullResource.includes('lambda:invoke')) {
            const match = fullResource.match(/function:([^:]+)/);
            if (match) return `Lambda Function: ${match[1]}`;
          }

          return fullResource;
        }
      }
    }

    // For Lambda-specific events
    if (event.type.includes('Lambda')) {
      const taskScheduledEvent = allEvents
        .slice(0, event.id)
        .reverse()
        .find(e => e.type === 'TaskScheduled' && e.taskScheduledEventDetails);

      if (taskScheduledEvent?.taskScheduledEventDetails) {
        const { resourceType, resource } = taskScheduledEvent.taskScheduledEventDetails;

        if (resourceType && resource) {
          return `${resourceType}:${resource}`;
        }

        // Fallback for Lambda
        if (taskScheduledEvent.taskScheduledEventDetails.resource?.includes('lambda')) {
          const fullResource = taskScheduledEvent.taskScheduledEventDetails.resource;
          const match = fullResource.match(/function:([^:]+)/);
          if (match) return `Lambda Function: ${match[1]}`;
        }
      }
    }

    // For execution events, return empty (AWS console shows empty)
    if (event.type.includes('Execution')) return '';

    return '';
  };

  const getDuration = () => {
    if (!event.timestamp) return null;

    const nextEvent = allEvents.find(e => e.id === event.id + 1);
    if (!nextEvent || !nextEvent.timestamp) return null;

    const start = new Date(event.timestamp).getTime();
    const end = new Date(nextEvent.timestamp).getTime();
    return end - start;
  };

  const duration = getDuration();
  const stepName = getStepName();
  const resourceName = getResourceName();

  const getEventDetails = () => {
    // Return only the relevant event details, not the entire event object
    if (event.taskScheduledEventDetails) return event.taskScheduledEventDetails;
    if (event.stateEnteredEventDetails) return event.stateEnteredEventDetails;
    if (event.stateExitedEventDetails) return event.stateExitedEventDetails;
    if (event.taskStateEnteredEventDetails) return event.taskStateEnteredEventDetails;
    if (event.taskSucceededEventDetails) return event.taskSucceededEventDetails;
    if (event.taskFailedEventDetails) return event.taskFailedEventDetails;
    if (event.lambdaFunctionSucceededEventDetails) return event.lambdaFunctionSucceededEventDetails;
    if (event.lambdaFunctionFailedEventDetails) return event.lambdaFunctionFailedEventDetails;
    if (event.executionStartedEventDetails) return event.executionStartedEventDetails;
    if (event.executionSucceededEventDetails) return event.executionSucceededEventDetails;
    if (event.executionFailedEventDetails) return event.executionFailedEventDetails;

    // If no specific details, return basic event info
    return {
      eventId: event.id,
      eventType: event.type,
      timestamp: event.timestamp,
      previousEventId: event.previousEventId
    };
  };

  const handleRowClick = (e: React.MouseEvent) => {
    // Prevent expansion when clicking on buttons or interactive elements
    if ((e.target as HTMLElement).closest('.event-actions')) {
      return;
    }
    setIsExpanded(!isExpanded);
  };

  return (
    <>
      <tr className="event-row" onClick={handleRowClick} data-event-type={event.type}>
        <td className="events-expand-col">
          <span className={`expand-arrow ${isExpanded ? 'expanded' : ''}`}>▶</span>
        </td>
        <td className="events-id-col">{event.id}</td>
        <td className="events-type-col">
          <div className="event-type-container">
            <span className="event-icon" style={{ color: getEventColor(event.type) }}>
              {getEventIcon(event.type)}
            </span>
            <span className="event-type-text">
              {event.type}
            </span>
          </div>
        </td>
        <td className="events-step-col" title={stepName}>
          <span className="step-name-text">{stepName}</span>
        </td>
        <td className="events-resource-col" title={resourceName}>
          <span className="resource-name-text">{resourceName}</span>
        </td>
        <td className="events-timestamp-col">
          <span className="timestamp-text">{formatDate(event.timestamp)}</span>
        </td>
      </tr>

      {isExpanded && (
        <tr className="event-details-row">
          <td colSpan={6}>
            <div className="event-details-simple">
              <table className="event-details-table">
                <thead>
                  <tr>
                    <th>Event ID</th>
                    <th>Type</th>
                    <th>Timestamp</th>
                    <th>Duration</th>
                    <th>Step Name</th>
                    <th>Resource</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{event.id}</td>
                    <td>{event.type}</td>
                    <td>{formatDate(event.timestamp)}</td>
                    <td>{duration ? formatDuration(duration) : '-'}</td>
                    <td>{stepName}</td>
                    <td>{resourceName}</td>
                  </tr>
                </tbody>
              </table>

              <div className="event-raw-details">
                <JsonViewer data={getEventDetails()} maxHeight="300px" />
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
};

const ExecutionDetails: React.FC<ExecutionDetailsProps> = ({ execution: propExecution, onClose }) => {
  const { executionArn } = useParams<{ executionArn: string }>();
  const navigate = useNavigate();

  const [execution, setExecution] = useState<StepFunctionExecution | null>(propExecution || null);
  const [history, setHistory] = useState<ExecutionHistoryEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pollingInterval, setPollingInterval] = useState<NodeJS.Timeout | null>(null);
  const [toast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [eventSearchFilter, setEventSearchFilter] = useState<string>('');
  const [eventDateFilter, setEventDateFilter] = useState<string>('');
  const [eventTypeFilter, setEventTypeFilter] = useState<string>('');
  const [selectedEventTypes, setSelectedEventTypes] = useState<Set<string>>(new Set());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false); // Auto-refresh disabled
  const [activeViewTab, setActiveViewTab] = useState<'overview' | 'input-output' | 'definition' | 'events'>('overview');
  const [activeEventsTab, setActiveEventsTab] = useState<'all' | 'errors'>('all');
  const [selectedStep, setSelectedStep] = useState<string | null>(null);
  const [activeStepTab, setActiveStepTab] = useState<'input-output' | 'details' | 'definition' | 'events'>('input-output');
  const [activeGraphTab, setActiveGraphTab] = useState<'graph' | 'table'>('graph');
  const [stateMachineDefinition, setStateMachineDefinition] = useState<any>(null);
  const [definitionLoading, setDefinitionLoading] = useState(false);
  const [definitionError, setDefinitionError] = useState<string | null>(null);
  const [showNewExecutionModal, setShowNewExecutionModal] = useState(false);
  const [newExecutionInput, setNewExecutionInput] = useState('{}');
  const [isStartingExecution, setIsStartingExecution] = useState(false);
  const [isRedriving, setIsRedriving] = useState(false);
  const [topPanelHeight, setTopPanelHeight] = useState(280);
  const [isResizing, setIsResizing] = useState(false);

  // Debug logging for state changes
  useEffect(() => {
    console.log('📊 Component state updated:', {
      execution: !!execution,
      historyCount: history.length,
      loading,
      error,
      stateMachineDefinition: !!stateMachineDefinition,
      definitionLoading,
      definitionError,
      activeViewTab
    });

    // Log sample of event step names when history changes
    if (history.length > 0) {
      console.log('📊 Sample event step names:');
      history.slice(0, 5).forEach(event => {
        const eventStepName =
          event.stateEnteredEventDetails?.name ||
          event.stateExitedEventDetails?.name ||
          event.taskStateEnteredEventDetails?.name;
        console.log('  -', event.type, ':', eventStepName || 'no name');
      });
    }
  }, [execution, history.length, loading, error, stateMachineDefinition, definitionLoading, definitionError, activeViewTab]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingInterval) {
        clearInterval(pollingInterval);
      }
    };
  }, [pollingInterval]);

  // Handle resize drag
  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    const startY = e.clientY;
    const startHeight = topPanelHeight;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientY - startY;
      const newHeight = Math.min(Math.max(startHeight + delta, 150), window.innerHeight * 0.6);
      setTopPanelHeight(newHeight);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // Removed unused getExecutionDuration function
  // Removed unused showToast function

  const loadExecution = async (arn: string) => {
    console.log('🔄 Loading execution data for ARN:', arn);
    setLoading(true);
    setError(null);

    try {
      const [executionData, historyData, stateMachineData] = await Promise.all([
        stepFunctionsService.describeExecution(arn),
        stepFunctionsService.getExecutionHistory(arn),
        stepFunctionsService.describeStateMachineForExecution(arn)
      ]);

      console.log('✅ Execution data loaded:', executionData);
      console.log('✅ History data loaded:', historyData?.length, 'events');
      console.log('✅ State machine data loaded:', stateMachineData);

      setExecution(executionData);
      setHistory(historyData || []);

      // Load state machine definition
      if (stateMachineData?.definition) {
        try {
          console.log('Attempting to parse definition:', typeof stateMachineData.definition, stateMachineData.definition);
          if (typeof stateMachineData.definition === 'string') {
            setStateMachineDefinition(JSON.parse(stateMachineData.definition));
          } else {
            setStateMachineDefinition(stateMachineData.definition);
          }
          console.log('✅ State machine definition parsed successfully');
        } catch (parseError) {
          console.error('❌ Failed to parse state machine definition:', parseError);
          console.error('Definition content:', stateMachineData.definition);
          setDefinitionError('Failed to parse state machine definition');
          setStateMachineDefinition(null);
        }
      } else {
        console.log('❌ No definition found in response');
        setStateMachineDefinition(null);
        setDefinitionError('No definition found in response');
      }
    } catch (error) {
      console.error('❌ Error loading execution:', error);
      setError(error instanceof Error ? error.message : 'Failed to load execution');
    } finally {
      setLoading(false);
    }
  };

  // Load execution data
  useEffect(() => {
    console.log('🔍 Initial load useEffect triggered:', {
      executionArn,
      propExecution: !!propExecution,
      shouldLoad: !!(executionArn && !propExecution)
    });

    if (executionArn && !propExecution) {
      loadExecution(executionArn);
    }
  }, [executionArn, propExecution]);

  // Load history when execution is provided as prop
  useEffect(() => {
    console.log('🔍 Prop execution history load useEffect triggered:', {
      propExecution: !!propExecution,
      executionArn: propExecution?.executionArn,
      historyLength: history.length
    });

    if (propExecution?.executionArn && history.length === 0) {
      console.log('🔄 Loading history for prop execution');
      loadExecutionHistory(propExecution.executionArn);
    }
  }, [propExecution?.executionArn, history.length]);

  const loadStateMachineDefinition = async (executionArn: string) => {
    console.log('🔄 Loading state machine definition for ARN:', executionArn);
    setDefinitionLoading(true);
    setDefinitionError(null);

    try {
      const data = await stepFunctionsService.describeStateMachineForExecution(executionArn);
      console.log('✅ State machine data received:', data);

      if (data?.definition) {
        try {
          // Log what we're trying to parse for debugging
          console.log('Attempting to parse definition:', typeof data.definition, data.definition);

          if (typeof data.definition === 'string') {
            setStateMachineDefinition(JSON.parse(data.definition));
          } else {
            // If it's already an object, use it directly
            setStateMachineDefinition(data.definition);
          }
          console.log('✅ State machine definition parsed successfully');
        } catch (parseError) {
          console.error('❌ Failed to parse state machine definition:', parseError);
          console.error('Definition content:', data.definition);
          setDefinitionError('Failed to parse state machine definition');
          setStateMachineDefinition(null);
        }
      } else {
        console.log('❌ No definition found in response');
        setStateMachineDefinition(null);
        setDefinitionError('No definition found in response');
      }
    } catch (error) {
      console.error('❌ Error loading state machine definition:', error);
      setDefinitionError(error instanceof Error ? error.message : 'Failed to load definition');
    } finally {
      setDefinitionLoading(false);
    }
  };

  // State machine definition is now loaded on page load, no need for separate useEffect



  const filterEvents = (events: ExecutionHistoryEvent[]) => {
    console.log('🔍 filterEvents called with:', events.length, 'events');
    console.log('🔍 Filter states:', { eventSearchFilter, eventDateFilter, eventTypeFilter, selectedEventTypes: selectedEventTypes.size });

    return events.filter(event => {
      // Text search filter
      if (eventSearchFilter) {
        const searchLower = eventSearchFilter.toLowerCase();
        const matchesSearch =
          event.type.toLowerCase().includes(searchLower) ||
          event.id.toString().includes(searchLower) ||
          JSON.stringify(event).toLowerCase().includes(searchLower);
        if (!matchesSearch) return false;
      }

      // Date filter
      if (eventDateFilter) {
        const eventDate = new Date(event.timestamp).toISOString().split('T')[0];
        if (eventDate !== eventDateFilter) return false;
      }

      // Type filter
      if (eventTypeFilter && eventTypeFilter !== 'all') {
        if (!event.type.toLowerCase().includes(eventTypeFilter.toLowerCase())) {
          return false;
        }
      }

      // Selected types filter
      if (selectedEventTypes.size > 0) {
        if (!selectedEventTypes.has(event.type)) return false;
      }

      return true;
    });
  };

  // Helper functions for step information
  const getUniqueSteps = () => {
    const steps = new Set<string>();

    // Extract step names from various event types
    history.forEach(event => {
      let stepName = null;

      // Check different event detail types for step names
      if (event.stateEnteredEventDetails?.name) {
        stepName = event.stateEnteredEventDetails.name;
      } else if (event.stateExitedEventDetails?.name) {
        stepName = event.stateExitedEventDetails.name;
      } else if (event.taskStateEnteredEventDetails?.name) {
        stepName = event.taskStateEnteredEventDetails.name;
      } else if (event.taskSucceededEventDetails && event.type === 'TaskSucceeded') {
        // For TaskSucceeded events, try to find the related state name from previous events
        const relatedEvent = history.slice(0, event.id).reverse().find(e =>
          e.type === 'TaskStateEntered' || e.type === 'StateEntered'
        );
        if (relatedEvent?.stateEnteredEventDetails?.name) {
          stepName = relatedEvent.stateEnteredEventDetails.name;
        } else if (relatedEvent?.taskStateEnteredEventDetails?.name) {
          stepName = relatedEvent.taskStateEnteredEventDetails.name;
        }
      } else if (event.taskFailedEventDetails && event.type === 'TaskFailed') {
        // For TaskFailed events, try to find the related state name from previous events
        const relatedEvent = history.slice(0, event.id).reverse().find(e =>
          e.type === 'TaskStateEntered' || e.type === 'StateEntered'
        );
        if (relatedEvent?.stateEnteredEventDetails?.name) {
          stepName = relatedEvent.stateEnteredEventDetails.name;
        } else if (relatedEvent?.taskStateEnteredEventDetails?.name) {
          stepName = relatedEvent.taskStateEnteredEventDetails.name;
        }
      }

      // Add step name if found and it's not the execution itself
      if (stepName && stepName !== 'Execution') {
        steps.add(stepName);
      }
    });

    // If no steps found through events, create a basic flow from event types
    if (steps.size === 0) {
      const eventTypes = new Set(history.map(e => e.type));
      if (eventTypes.has('ExecutionStarted')) steps.add('Start');
      if (eventTypes.has('TaskScheduled') || eventTypes.has('TaskSucceeded') || eventTypes.has('TaskFailed')) {
        steps.add('Task');
      }
      if (eventTypes.has('ExecutionSucceeded')) steps.add('Success');
      if (eventTypes.has('ExecutionFailed')) steps.add('Failed');
    }

    return Array.from(steps);
  };

  const getStepEvents = (stepName: string) => {
    console.log('🔍 getStepEvents for step:', stepName, 'total history events:', history.length);

    // For synthetic step names, use simple pattern matching
    if (stepName === 'Start') {
      return history.filter(event => event.type === 'ExecutionStarted');
    }
    if (stepName === 'Task') {
      return history.filter(event => event.type.includes('Task') || event.type.includes('Lambda'));
    }
    if (stepName === 'Success') {
      return history.filter(event => event.type === 'ExecutionSucceeded');
    }
    if (stepName === 'Failed') {
      return history.filter(event => event.type === 'ExecutionFailed');
    }

    // For real step names, find all events related to this step
    // First, find the step entry event to get the event ID range
    const stepEntryEvent = history.find(event => {
      const eventStepName =
        event.stateEnteredEventDetails?.name ||
        event.taskStateEnteredEventDetails?.name;
      return eventStepName === stepName;
    });

    if (!stepEntryEvent) {
      console.log('🔍 No entry event found for step:', stepName);
      return [];
    }

    // Find the step exit event
    const stepExitEvent = history.find(event => {
      const eventStepName = event.stateExitedEventDetails?.name;
      return eventStepName === stepName;
    });

    const startEventId = stepEntryEvent.id;
    const endEventId = stepExitEvent ? stepExitEvent.id : startEventId + 10; // Fallback range

    console.log('🔍 Step event range:', startEventId, 'to', endEventId);

    // Get all events in the range that are related to this step
    const matchedEvents = history.filter(event => {
      // Include events in the ID range
      if (event.id >= startEventId && event.id <= endEventId) {
        // Direct name matches
        const eventStepName =
          event.stateEnteredEventDetails?.name ||
          event.stateExitedEventDetails?.name ||
          event.taskStateEnteredEventDetails?.name;

        // Include if it has the step name OR if it's a task-related event in the range
        if (eventStepName === stepName) {
          return true;
        }

        // Include task-related events that don't have step names but are in the range
        if (event.type.includes('Task') ||
          event.type.includes('Lambda') ||
          event.type.includes('Activity') ||
          event.type.includes('Pass') ||
          event.type.includes('Choice') ||
          event.type.includes('Wait') ||
          event.type.includes('Parallel') ||
          event.type.includes('Map')) {
          return true;
        }
      }

      return false;
    });

    console.log('🔍 Found', matchedEvents.length, 'events for step:', stepName);
    return matchedEvents.sort((a, b) => a.id - b.id);
  };

  const getStepStatus = (stepName: string) => {
    const stepEvents = getStepEvents(stepName);
    
    // Get the latest terminal event for this step (by highest event ID)
    const sortedEvents = [...stepEvents].sort((a, b) => b.id - a.id);
    
    // Find the most recent terminal state (succeeded or failed)
    for (const event of sortedEvents) {
      if (event.type.includes('Succeeded') || event.type.includes('Exited')) {
        return 'succeeded';
      }
      if (event.type.includes('Failed') || event.type.includes('TimedOut') || event.type.includes('Aborted')) {
        return 'failed';
      }
    }

    // Check if step has started (no terminal state yet)
    const hasStarted = stepEvents.some(e =>
      e.type.includes('Started') || e.type.includes('Entered') || e.type.includes('Scheduled')
    );
    if (hasStarted) return 'running';

    return 'pending';
  };

  const getStepType = (stepName: string) => {
    const stepEvents = getStepEvents(stepName);
    const taskEvent = stepEvents.find(e => e.type === 'TaskScheduled');

    if (taskEvent?.taskScheduledEventDetails?.resourceType) {
      return taskEvent.taskScheduledEventDetails.resourceType;
    }

    return 'Task';
  };

  const getStepDuration = (stepName: string) => {
    const stepEvents = getStepEvents(stepName);
    const startEvent = stepEvents.find(e => e.type.includes('Entered') || e.type.includes('Started'));
    const endEvent = stepEvents.find(e => e.type.includes('Exited') || e.type.includes('Succeeded') || e.type.includes('Failed'));

    if (startEvent && endEvent) {
      const duration = new Date(endEvent.timestamp).getTime() - new Date(startEvent.timestamp).getTime();
      return formatDuration(duration);
    }

    return '-';
  };

  const getStepResource = (stepName: string) => {
    const stepEvents = getStepEvents(stepName);
    const taskEvent = stepEvents.find(e => e.type === 'TaskScheduled');

    if (taskEvent?.taskScheduledEventDetails) {
      const { resourceType, resource } = taskEvent.taskScheduledEventDetails;

      if (resourceType && resource) {
        return `${resourceType}:${resource}`;
      }

      if (taskEvent.taskScheduledEventDetails.resource) {
        const fullResource = taskEvent.taskScheduledEventDetails.resource;

        if (fullResource.includes('arn:aws:states:::aws-sdk:')) {
          return fullResource.replace('arn:aws:states:::', '');
        }

        if (fullResource.includes('lambda:invoke')) {
          const match = fullResource.match(/function:([^:]+)/);
          if (match) return `Lambda Function: ${match[1]}`;
        }

        return fullResource;
      }
    }

    return '';
  };

  // Add missing functions
  const getStepDefinition = (stepName: string) => {
    if (!stateMachineDefinition) {
      return null;
    }

    try {
      // Parse the definition if it's a string
      const definition = typeof stateMachineDefinition === 'string' 
        ? JSON.parse(stateMachineDefinition) 
        : stateMachineDefinition;

      // Look for the step in the States object
      if (definition.States && definition.States[stepName]) {
        return definition.States[stepName];
      }

      // If not found directly, return null
      return null;
    } catch (error) {
      console.error('Error parsing state machine definition:', error);
      return null;
    }
  };

  const getStepInput = (stepName: string) => {
    const stepEvents = getStepEvents(stepName);
    console.log('🔍 getStepInput for step:', stepName, 'found events:', stepEvents.length);
    
    // Look for input in multiple event types, prioritizing the most specific ones
    const inputEvent = stepEvents.find(e =>
      e.type === 'TaskScheduled' ||
      e.type === 'StateEntered' ||
      e.type === 'TaskStateEntered' ||
      e.type === 'ExecutionStarted' ||
      e.type === 'LambdaFunctionScheduled' ||
      e.type === 'ActivityScheduled'
    );
    console.log('🔍 Input event found:', inputEvent?.type, inputEvent);

    // Check TaskScheduled parameters
    if (inputEvent?.taskScheduledEventDetails?.parameters) {
      try {
        return JSON.parse(inputEvent.taskScheduledEventDetails.parameters);
      } catch {
        return inputEvent.taskScheduledEventDetails.parameters;
      }
    }

    // Check StateEntered input
    if (inputEvent?.stateEnteredEventDetails?.input) {
      try {
        return JSON.parse(inputEvent.stateEnteredEventDetails.input);
      } catch {
        return inputEvent.stateEnteredEventDetails.input;
      }
    }

    // Check TaskStateEntered input
    if (inputEvent?.taskStateEnteredEventDetails?.input) {
      try {
        return JSON.parse(inputEvent.taskStateEnteredEventDetails.input);
      } catch {
        return inputEvent.taskStateEnteredEventDetails.input;
      }
    }

    // Check ExecutionStarted input (for the first step)
    if (inputEvent?.executionStartedEventDetails?.input) {
      try {
        return JSON.parse(inputEvent.executionStartedEventDetails.input);
      } catch {
        return inputEvent.executionStartedEventDetails.input;
      }
    }

    // If no specific input event found, look for any event with input data
    for (const event of stepEvents) {
      // Check various event detail types for input
      if (event.stateEnteredEventDetails?.input) {
        try {
          return JSON.parse(event.stateEnteredEventDetails.input);
        } catch {
          return event.stateEnteredEventDetails.input;
        }
      }
      
      if (event.taskStateEnteredEventDetails?.input) {
        try {
          return JSON.parse(event.taskStateEnteredEventDetails.input);
        } catch {
          return event.taskStateEnteredEventDetails.input;
        }
      }

      if (event.taskScheduledEventDetails?.parameters) {
        try {
          return JSON.parse(event.taskScheduledEventDetails.parameters);
        } catch {
          return event.taskScheduledEventDetails.parameters;
        }
      }
    }

    // Return empty object instead of null when no input is found
    return {};
  };

  const getStepOutput = (stepName: string) => {
    const stepEvents = getStepEvents(stepName);
    console.log('🔍 getStepOutput for step:', stepName, 'found events:', stepEvents.length);
    
    // Look for output in multiple event types, prioritizing success events
    const outputEvent = stepEvents.find(e =>
      e.type === 'TaskSucceeded' ||
      e.type === 'StateExited' ||
      e.type === 'LambdaFunctionSucceeded' ||
      e.type === 'ActivitySucceeded' ||
      e.type === 'ExecutionSucceeded'
    );
    console.log('🔍 Output event found:', outputEvent?.type, outputEvent);

    // Check TaskSucceeded output
    if (outputEvent?.taskSucceededEventDetails?.output) {
      try {
        return JSON.parse(outputEvent.taskSucceededEventDetails.output);
      } catch {
        return outputEvent.taskSucceededEventDetails.output;
      }
    }

    // Check StateExited output
    if (outputEvent?.stateExitedEventDetails?.output) {
      try {
        return JSON.parse(outputEvent.stateExitedEventDetails.output);
      } catch {
        return outputEvent.stateExitedEventDetails.output;
      }
    }

    // Check LambdaFunctionSucceeded output
    if (outputEvent?.lambdaFunctionSucceededEventDetails?.output) {
      try {
        return JSON.parse(outputEvent.lambdaFunctionSucceededEventDetails.output);
      } catch {
        return outputEvent.lambdaFunctionSucceededEventDetails.output;
      }
    }

    // Check ExecutionSucceeded output (for final step)
    if (outputEvent?.executionSucceededEventDetails?.output) {
      try {
        return JSON.parse(outputEvent.executionSucceededEventDetails.output);
      } catch {
        return outputEvent.executionSucceededEventDetails.output;
      }
    }

    // Check for failed events
    const failedEvent = stepEvents.find(e =>
      e.type === 'TaskFailed' ||
      e.type === 'LambdaFunctionFailed' ||
      e.type === 'ExecutionFailed' ||
      e.type === 'ActivityFailed'
    );

    if (failedEvent?.taskFailedEventDetails) {
      return failedEvent.taskFailedEventDetails;
    }

    if (failedEvent?.lambdaFunctionFailedEventDetails) {
      return failedEvent.lambdaFunctionFailedEventDetails;
    }

    if (failedEvent?.executionFailedEventDetails) {
      return failedEvent.executionFailedEventDetails;
    }

    // If no specific output event found, look for any event with output data
    for (const event of stepEvents) {
      // Check various event detail types for output
      if (event.stateExitedEventDetails?.output) {
        try {
          return JSON.parse(event.stateExitedEventDetails.output);
        } catch {
          return event.stateExitedEventDetails.output;
        }
      }
      
      if (event.taskSucceededEventDetails?.output) {
        try {
          return JSON.parse(event.taskSucceededEventDetails.output);
        } catch {
          return event.taskSucceededEventDetails.output;
        }
      }

      if (event.lambdaFunctionSucceededEventDetails?.output) {
        try {
          return JSON.parse(event.lambdaFunctionSucceededEventDetails.output);
        } catch {
          return event.lambdaFunctionSucceededEventDetails.output;
        }
      }

      if (event.executionSucceededEventDetails?.output) {
        try {
          return JSON.parse(event.executionSucceededEventDetails.output);
        } catch {
          return event.executionSucceededEventDetails.output;
        }
      }
    }

    // Return empty object instead of null when no output is found
    return {};
  };



  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
    return `${(ms / 3600000).toFixed(1)}h`;
  };

  const loadExecutionHistory = async (arn: string) => {
    setLoading(true);
    setError(null);

    try {
      const [historyData, stateMachineData] = await Promise.all([
        stepFunctionsService.getExecutionHistory(arn),
        stepFunctionsService.describeStateMachineForExecution(arn)
      ]);

      setHistory(historyData || []);

      // Load state machine definition if not already loaded
      if (!stateMachineDefinition && stateMachineData?.definition) {
        try {
          console.log('Attempting to parse definition:', typeof stateMachineData.definition, stateMachineData.definition);
          if (typeof stateMachineData.definition === 'string') {
            setStateMachineDefinition(JSON.parse(stateMachineData.definition));
          } else {
            setStateMachineDefinition(stateMachineData.definition);
          }
          console.log('✅ State machine definition parsed successfully');
        } catch (parseError) {
          console.error('❌ Failed to parse state machine definition:', parseError);
          console.error('Definition content:', stateMachineData.definition);
          setDefinitionError('Failed to parse state machine definition');
          setStateMachineDefinition(null);
        }
      }
    } catch (err) {
      console.error('Failed to load execution history:', err);
      setError(err instanceof Error ? err.message : 'Failed to load execution history');
    } finally {
      setLoading(false);
    }
  };

  const loadExecutionDetails = async (arn: string) => {
    setLoading(true);
    setError(null);

    try {
      const [executionData, historyData, stateMachineData] = await Promise.all([
        stepFunctionsService.describeExecution(arn),
        stepFunctionsService.getExecutionHistory(arn),
        stepFunctionsService.describeStateMachineForExecution(arn)
      ]);

      setExecution(executionData);
      setHistory(historyData || []);

      // Load state machine definition
      if (stateMachineData?.definition) {
        try {
          console.log('Attempting to parse definition:', typeof stateMachineData.definition, stateMachineData.definition);
          if (typeof stateMachineData.definition === 'string') {
            setStateMachineDefinition(JSON.parse(stateMachineData.definition));
          } else {
            setStateMachineDefinition(stateMachineData.definition);
          }
          console.log('✅ State machine definition parsed successfully');
        } catch (parseError) {
          console.error('❌ Failed to parse state machine definition:', parseError);
          console.error('Definition content:', stateMachineData.definition);
          setDefinitionError('Failed to parse state machine definition');
          setStateMachineDefinition(null);
        }
      } else {
        console.log('❌ No definition found in response');
        setStateMachineDefinition(null);
        setDefinitionError('No definition found in response');
      }
    } catch (err) {
      console.error('Failed to load execution details:', err);
      setError(err instanceof Error ? err.message : 'Failed to load execution details');
    } finally {
      setLoading(false);
    }
  };

  const refreshExecution = async () => {
    if (!execution?.executionArn) return;

    setIsRefreshing(true);
    try {
      if (propExecution) {
        // If execution was provided as prop, refresh history and definition
        await loadExecutionHistory(execution.executionArn);
      } else {
        // If loaded from URL, refresh execution, history, and definition
        await loadExecutionDetails(execution.executionArn);
      }
    } catch (err) {
      console.error('Failed to refresh execution:', err);
    } finally {
      setIsRefreshing(false);
    }
  };



  const handleStopExecution = async () => {
    if (!execution?.executionArn) return;

    try {
      await stepFunctionsService.stopExecution(execution.executionArn);
      await refreshExecution();
    } catch (err) {
      console.error('Failed to stop execution:', err);
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
        // Navigate to the new execution
        navigate(`/execution/${encodeURIComponent(result.executionArn)}`);
      }
    } catch (err) {
      console.error('Failed to start new execution:', err);
      setError(err instanceof Error ? err.message : 'Failed to start new execution');
    } finally {
      setIsStartingExecution(false);
    }
  };

  const handleRedriveExecution = async () => {
    if (!execution?.executionArn) return;

    setIsRedriving(true);
    try {
      const result = await stepFunctionsService.redriveExecution(execution.executionArn);
      if (result) {
        // Update status to RUNNING immediately for UI feedback
        setExecution(prev => prev ? { ...prev, status: 'RUNNING' } : null);
        // Start polling for updates
        startPolling();
      }
    } catch (err) {
      console.error('Failed to redrive execution:', err);
      setError(err instanceof Error ? err.message : 'Failed to redrive execution');
    } finally {
      setIsRedriving(false);
    }
  };

  const startPolling = () => {
    // Clear any existing polling
    if (pollingInterval) {
      clearInterval(pollingInterval);
    }
    
    // Poll every 2 seconds while execution is running
    const interval = setInterval(async () => {
      if (!execution?.executionArn) return;
      
      try {
        const [executionData, historyData] = await Promise.all([
          stepFunctionsService.describeExecution(execution.executionArn),
          stepFunctionsService.getExecutionHistory(execution.executionArn)
        ]);
        
        if (executionData) {
          setExecution(executionData);
          setHistory(historyData || []);
          
          // Stop polling if execution is no longer running
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

  const canRedrive = execution?.status === 'FAILED' || execution?.status === 'TIMED_OUT' || execution?.status === 'ABORTED';

  const handleClose = () => {
    if (pollingInterval) {
      clearInterval(pollingInterval);
    }
    if (onClose) {
      onClose();
    } else {
      navigate(-1);
    }
  };

  let filteredEvents = filterEvents(history);

  // Filter events based on active events tab
  if (activeEventsTab === 'errors') {
    filteredEvents = filteredEvents.filter(event =>
      event.type.toLowerCase().includes('failed') ||
      event.type.toLowerCase().includes('error')
    );
  }

  // Debug events when on events tab
  useEffect(() => {
    if (activeViewTab === 'events') {
      console.log('🔍 Events debug:', {
        totalHistory: history.length,
        filteredEvents: filteredEvents.length,
        activeEventsTab,
        eventSearchFilter,
        eventTypeFilter
      });
    }
  }, [activeViewTab, history.length, filteredEvents.length, activeEventsTab, eventSearchFilter, eventTypeFilter]);

  const uniqueEventTypes = Array.from(new Set(history.map(e => e.type))).sort();

  return (
    <div className="execution-details">
      {toast && (
        <div className={`toast toast-${toast.type}`}>
          {toast.message}
        </div>
      )}

      <div className="execution-header">
        <div className="execution-title">
          <h2>Execution Details</h2>
        </div>

        <div className="execution-status">
          <div className="status-info">
            <span className={`status-badge status-badge-large status-${execution?.status?.toLowerCase()}`}>
              <span className="status-icon">
                {execution?.status === 'SUCCEEDED' ? '✓' :
                  execution?.status === 'FAILED' ? '✗' :
                    execution?.status === 'RUNNING' ? '' :
                      execution?.status === 'TIMED_OUT' ? '⏱' :
                        execution?.status === 'ABORTED' ? '⏹' :
                          execution?.status === 'STOPPED' ? '⏹' :
                            execution?.status === 'CANCELLED' ? '⏹' : '○'}
              </span>
              <span className="status-text">
                {execution?.status}
              </span>
            </span>
          </div>

          <div className="execution-actions">
            <button
              onClick={() => {
                // Pre-populate with current execution's input if available
                let inputToUse = '{}';
                if (execution?.input) {
                  inputToUse = execution.input;
                } else {
                  // Fallback: try to get input from ExecutionStarted event in history
                  const startEvent = history.find(e => e.type === 'ExecutionStarted');
                  if (startEvent?.executionStartedEventDetails?.input) {
                    inputToUse = startEvent.executionStartedEventDetails.input;
                  }
                }
                setNewExecutionInput(inputToUse);
                setShowNewExecutionModal(true);
              }}
              className="btn btn-primary"
              disabled={!execution?.stateMachineArn}
            >
              New execution
            </button>

            {canRedrive && (
              <button
                onClick={handleRedriveExecution}
                className="btn btn-warning"
                disabled={isRedriving}
              >
                {isRedriving ? 'Redriving...' : 'Redrive'}
              </button>
            )}

            {execution?.status === 'RUNNING' && (
              <button
                onClick={handleStopExecution}
                className="btn btn-danger"
              >
                Stop execution
              </button>
            )}

            <button onClick={handleClose} className="btn btn-secondary">
              {onClose ? 'Close' : 'Back'}
            </button>
          </div>
        </div>
      </div>

      {/* Top Panel - Execution Details Tabs */}
      <div className="execution-top-panel" style={{ height: topPanelHeight, maxHeight: topPanelHeight }}>
        <div className="execution-detail-tabs">
          <button
            className={`execution-tab ${activeViewTab === 'overview' ? 'active' : ''}`}
            onClick={() => setActiveViewTab('overview')}
          >
            Details
          </button>
          <button
            className={`execution-tab ${activeViewTab === 'input-output' ? 'active' : ''}`}
            onClick={() => setActiveViewTab('input-output')}
          >
            Execution input and output
          </button>
          <button
            className={`execution-tab ${activeViewTab === 'definition' ? 'active' : ''}`}
            onClick={() => {
              console.log('Definition tab clicked');
              setActiveViewTab('definition');
            }}
          >
            Definition
          </button>
          <button
            className={`execution-tab ${activeViewTab === 'events' ? 'active' : ''}`}
            onClick={() => setActiveViewTab('events')}
          >
            Events
          </button>
        </div>

        <div className="execution-detail-content">
          {activeViewTab === 'overview' && (
            <div className="execution-details-grid">
              <div className="detail-row four-columns">
                <div className="detail-column">
                  <div className="detail-item">
                    <span className="detail-label">Execution status</span>
                    <span className="detail-value">
                      <span className={`status-badge status-${execution?.status?.toLowerCase()}`}>
                        <span className="status-icon">
                          {execution?.status === 'SUCCEEDED' ? '✓' :
                            execution?.status === 'FAILED' ? '✗' :
                              execution?.status === 'RUNNING' ? '' :
                                execution?.status === 'TIMED_OUT' ? '⏱' :
                                  execution?.status === 'ABORTED' ? '⏹' :
                                    execution?.status === 'STOPPED' ? '⏹' :
                                      execution?.status === 'CANCELLED' ? '⏹' : '○'}
                        </span>
                        {execution?.status}
                      </span>
                    </span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Execution type</span>
                    <span className="detail-value">Standard</span>
                  </div>
                </div>
                <div className="detail-column">
                  <div className="detail-item">
                    <span className="detail-label">Start time</span>
                    <span className="detail-value">{execution?.startDate ? formatDate(execution.startDate) : 'N/A'}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">End time</span>
                    <span className="detail-value">{execution?.stopDate ? formatDate(execution.stopDate) : '-'}</span>
                  </div>
                </div>
                <div className="detail-column">
                  <div className="detail-item">
                    <span className="detail-label">Total events</span>
                    <span className="detail-value">{history.length}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Duration</span>
                    <span className="detail-value">
                      {execution?.stopDate && execution?.startDate ? formatDuration(new Date(execution.stopDate).getTime() - new Date(execution.startDate).getTime()) : '-'}
                    </span>
                  </div>
                </div>
                <div className="detail-column">
                  <div className="detail-item">
                    <span className="detail-label">State machine ARN</span>
                    <div className="execution-arn">
                      <span>{execution?.stateMachineArn || 'N/A'}</span>
                      <span className="arn-copy-icon" title="Copy ARN">📋</span>
                    </div>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Execution ARN</span>
                    <div className="execution-arn">
                      <span>{execution?.executionArn || 'N/A'}</span>
                      <span className="arn-copy-icon" title="Copy ARN">📋</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeViewTab === 'input-output' && (
            <div className="input-output-grid">
              <div className="input-section">
                <h4>Execution Input</h4>
                <div className="json-viewer-container">
                  {(() => {
                    // Get input from ExecutionStarted event
                    const startEvent = history.find(event => event.type === 'ExecutionStarted');
                    const inputData = startEvent?.executionStartedEventDetails?.input || execution?.input;

                    if (inputData) {
                      try {
                        const parsedInput = typeof inputData === 'string' ? JSON.parse(inputData) : inputData;
                        return (
                          <JsonViewer
                            data={parsedInput}
                            maxHeight="250px"
                            showLineNumbers={true}
                          />
                        );
                      } catch (error) {
                        return (
                          <div className="error-output">
                            <div className="error-icon">⚠️</div>
                            <div className="error-content">
                              <div className="error-title">Invalid JSON Input</div>
                              <div className="error-text">The input data is not valid JSON format.</div>
                              <div className="raw-content">
                                <pre>{inputData}</pre>
                              </div>
                            </div>
                          </div>
                        );
                      }
                    } else {
                      return (
                        <div className="no-data-message">
                          <span className="no-data-text">No input provided</span>
                        </div>
                      );
                    }
                  })()}
                </div>
              </div>
              <div className="output-section">
                <h4>Execution Output</h4>
                <div className="json-viewer-container">
                  {(() => {
                    // Get output from ExecutionSucceeded or ExecutionFailed event
                    const endEvent = history.find(event => 
                      event.type === 'ExecutionSucceeded' || event.type === 'ExecutionFailed'
                    );
                    
                    let outputData;
                    if (endEvent?.type === 'ExecutionSucceeded' && endEvent.executionSucceededEventDetails?.output) {
                      outputData = endEvent.executionSucceededEventDetails.output;
                    } else if (endEvent?.type === 'ExecutionFailed' && endEvent.executionFailedEventDetails?.error) {
                      outputData = {
                        error: endEvent.executionFailedEventDetails.error,
                        cause: endEvent.executionFailedEventDetails.cause
                      };
                    } else {
                      outputData = execution?.output;
                    }

                    if (outputData) {
                      try {
                        const parsedOutput = typeof outputData === 'string' ? JSON.parse(outputData) : outputData;
                        const isError = endEvent?.type === 'ExecutionFailed';
                        return (
                          <JsonViewer
                            data={parsedOutput}
                            maxHeight="250px"
                            showLineNumbers={true}
                            isError={isError}
                          />
                        );
                      } catch (error) {
                        return (
                          <div className={endEvent?.type === 'ExecutionFailed' ? "error-output" : "raw-output"}>
                            <div className="raw-content">
                              <pre>{outputData}</pre>
                            </div>
                          </div>
                        );
                      }
                    } else if (execution?.status === 'FAILED') {
                      return (
                        <div className="no-data-message error">
                          <span className="no-data-text">Execution failed - no output available</span>
                        </div>
                      );
                    } else if (execution?.status === 'RUNNING') {
                      return (
                        <div className="no-data-message">
                          <span className="no-data-text">Execution still running - output not yet available</span>
                        </div>
                      );
                    } else {
                      return (
                        <div className="no-data-message">
                          <span className="no-data-text">No output available</span>
                        </div>
                      );
                    }
                  })()}
                </div>
              </div>
            </div>
          )}

          {activeViewTab === 'definition' && (
            <div className="definition-content">
              {definitionLoading ? (
                <div className="loading-message">
                  <div className="loading-spinner"></div>
                  <span>Loading state machine definition...</span>
                </div>
              ) : definitionError ? (
                <div className="error-message">
                  <div className="error-icon">⚠️</div>
                  <div className="error-content">
                    <div className="error-title">Failed to Load Definition</div>
                    <div className="error-text">{definitionError}</div>
                    <button
                      onClick={() => execution?.executionArn && loadStateMachineDefinition(execution.executionArn)}
                      className="btn btn-outline-primary btn-sm"
                    >
                      Retry
                    </button>
                  </div>
                </div>
              ) : stateMachineDefinition ? (
                <div className="definition-json">
                  <JsonViewer
                    data={stateMachineDefinition}
                    maxHeight="150px"
                    showLineNumbers={true}
                  />
                </div>
              ) : (
                <div className="definition-placeholder">
                  <div className="placeholder-content">
                    <div className="placeholder-icon">📋</div>
                    <div className="placeholder-text">
                      <h4>State Machine Definition</h4>
                      <p>Click "Load Definition" to load the state machine definition for this execution.</p>
                    </div>
                    <button
                      onClick={() => execution?.executionArn && loadStateMachineDefinition(execution.executionArn)}
                      className="btn btn-primary"
                    >
                      Load Definition
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeViewTab === 'events' && (
            <div className="events-summary">
              <div className="events-stats">
                <div className="events-header-info">
                  <span className="events-count">Total Events: {history.length}</span>
                  <span className="events-filtered">Filtered: {filteredEvents.length}</span>
                  <span className="events-errors">
                    Errors: {history.filter(e => e.type.toLowerCase().includes('failed') || e.type.toLowerCase().includes('error')).length}
                  </span>
                </div>
                <div className="events-tabs">
                  <button
                    className={`events-tab ${activeEventsTab === 'all' ? 'active' : ''}`}
                    onClick={() => setActiveEventsTab('all')}
                  >
                    All Events
                  </button>
                  <button
                    className={`events-tab ${activeEventsTab === 'errors' ? 'active' : ''}`}
                    onClick={() => setActiveEventsTab('errors')}
                  >
                    Errors
                  </button>
                </div>
              </div>
              
              {/* All Events with Scrollbar */}
              <div className="all-events-preview">
                <h4>All Events ({activeEventsTab === 'errors' ? 
                  history.filter(e => e.type.toLowerCase().includes('failed') || e.type.toLowerCase().includes('error')).length : 
                  history.length})</h4>
                <div className="events-scrollable-table">
                  <table className="full-events-table">
                    <thead>
                      <tr>
                        <th className="expand-col"></th>
                        <th>ID</th>
                        <th>Type</th>
                        <th>Step</th>
                        <th>Timestamp</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(activeEventsTab === 'errors' ? 
                        history.filter(e => e.type.toLowerCase().includes('failed') || e.type.toLowerCase().includes('error')) : 
                        history
                      ).map(event => {
                        return (
                          <TopPanelEventRow
                            key={event.id}
                            event={event}
                            formatDate={formatDate}
                          />
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Resize Handle */}
      <div 
        className={`resize-handle ${isResizing ? 'resizing' : ''}`}
        onMouseDown={handleResizeMouseDown}
      >
        <div className="resize-handle-bar" />
      </div>

      {/* Main Content Area - Standardized Layout for All Tabs */}
      <div className="execution-content">
        <div className="graph-and-step-container">
          {/* Left Panel - Graph View (35% width - consistent across all tabs) */}
          <div className="graph-panel">
            <div className="graph-header">
              <div className="graph-tabs">
                <button 
                  className={`graph-tab ${activeGraphTab === 'graph' ? 'active' : ''}`}
                  onClick={() => setActiveGraphTab('graph')}
                >
                  Graph view
                </button>
                <button 
                  className={`graph-tab ${activeGraphTab === 'table' ? 'active' : ''}`}
                  onClick={() => setActiveGraphTab('table')}
                >
                  Table view
                </button>
              </div>
            </div>

            <div className="graph-content">
              {activeGraphTab === 'graph' ? (
                <div className="graph-view">
                  <div className="graph-legend">
                    <div className="legend-item">
                      <div className="legend-icon" style={{ backgroundColor: '#28a745' }}>✓</div>
                      <span>Succeeded</span>
                    </div>
                    <div className="legend-item">
                      <div className="legend-icon" style={{ backgroundColor: '#dc3545' }}>✗</div>
                      <span>Failed</span>
                    </div>
                    <div className="legend-item">
                      <div className="legend-icon" style={{ backgroundColor: '#007bff' }}></div>
                      <span>Running</span>
                    </div>
                  </div>

                  <div className="steps-graph">
                    {getUniqueSteps().length > 0 ? (
                      getUniqueSteps().map((stepName, index) => (
                        <div
                          key={stepName}
                          className={`step-node ${selectedStep === stepName ? 'selected' : ''}`}
                          onClick={() => setSelectedStep(stepName)}
                        >
                          <div className="step-icon" style={{
                            backgroundColor: getStepStatus(stepName) === 'succeeded' ? '#28a745' :
                              getStepStatus(stepName) === 'failed' ? '#dc3545' : '#007bff'
                          }}>
                            {getStepStatus(stepName) === 'succeeded' ? '✓' :
                              getStepStatus(stepName) === 'failed' ? '✗' : ''}
                          </div>
                          <div className="step-name">{stepName}</div>
                          <div className="step-status">{getStepStatus(stepName)}</div>
                          {index < getUniqueSteps().length - 1 && <div className="step-connector"></div>}
                        </div>
                      ))
                    ) : (
                      <div className="fallback-steps">
                        {/* Show a basic workflow representation based on events */}
                        <div className="step-node">
                          <div className="step-icon" style={{ backgroundColor: '#28a745' }}>✓</div>
                          <div className="step-name">Execution Started</div>
                          <div className="step-status">completed</div>
                        </div>
                        <div className="step-connector"></div>
                        <div className="step-node">
                          <div className="step-icon" style={{ backgroundColor: '#007bff' }}>⚙</div>
                          <div className="step-name">Processing Steps</div>
                          <div className="step-status">running</div>
                        </div>
                        <div className="step-connector"></div>
                        <div className="step-node">
                          <div className="step-icon" style={{ backgroundColor: execution?.status === 'SUCCEEDED' ? '#28a745' : '#dc3545' }}>
                            {execution?.status === 'SUCCEEDED' ? '✓' : '✗'}
                          </div>
                          <div className="step-name">Execution {execution?.status}</div>
                          <div className="step-status">{execution?.status?.toLowerCase()}</div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="table-view">
                  <table className="steps-table">
                    <thead>
                      <tr>
                        <th>Step Name</th>
                        <th>Type</th>
                        <th>Status</th>
                        <th>Duration</th>
                        <th>Resource</th>
                      </tr>
                    </thead>
                    <tbody>
                      {getUniqueSteps().length > 0 ? (
                        getUniqueSteps().map((stepName) => (
                          <tr
                            key={stepName}
                            className={`step-row ${selectedStep === stepName ? 'selected' : ''}`}
                            onClick={() => setSelectedStep(stepName)}
                          >
                            <td>
                              <div className="step-name-cell">
                                <div className="step-icon" style={{
                                  backgroundColor: getStepStatus(stepName) === 'succeeded' ? '#28a745' :
                                    getStepStatus(stepName) === 'failed' ? '#dc3545' : '#007bff'
                                }}>
                                  {getStepStatus(stepName) === 'succeeded' ? '✓' :
                                    getStepStatus(stepName) === 'failed' ? '✗' : ''}
                                </div>
                                <span className="step-name-text">{stepName}</span>
                              </div>
                            </td>
                            <td>
                              <span className="step-type-text">{getStepType(stepName)}</span>
                            </td>
                            <td>
                              <span className={`status-indicator status-${getStepStatus(stepName)}`}>
                                {getStepStatus(stepName)}
                              </span>
                            </td>
                            <td>
                              <span className="duration-text">{getStepDuration(stepName)}</span>
                            </td>
                            <td>
                              <span className="resource-text" title={getStepResource(stepName)}>
                                {getStepResource(stepName)}
                              </span>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={5} className="no-steps">
                            <p>No steps found in this execution.</p>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Right Panel - Content Panel (65% width - consistent across all tabs) */}
          <div className="content-panel">
            {selectedStep ? (
              /* Step Details Panel - When step is selected */
              <div className="step-details-panel">
                <div className="step-details-header">
                  <div className="step-header-content">
                    <h3>Step Details: {selectedStep}</h3>
                    <div className="step-resource">
                      <span className="resource-text">{getStepResource(selectedStep)}</span>
                    </div>
                  </div>
                  <div className="step-actions">
                    <button
                      onClick={() => setSelectedStep(null)}
                      className="back-button"
                    >
                      ← Back
                    </button>
                  </div>
                </div>

                <div className="step-detail-tabs">
                  <button
                    className={`detail-tab ${activeStepTab === 'input-output' ? 'active' : ''}`}
                    onClick={() => setActiveStepTab('input-output')}
                  >
                    Input/Output
                  </button>
                  <button
                    className={`detail-tab ${activeStepTab === 'details' ? 'active' : ''}`}
                    onClick={() => setActiveStepTab('details')}
                  >
                    Details
                  </button>
                  <button
                    className={`detail-tab ${activeStepTab === 'definition' ? 'active' : ''}`}
                    onClick={() => setActiveStepTab('definition')}
                  >
                    Definition
                  </button>
                  <button
                    className={`detail-tab ${activeStepTab === 'events' ? 'active' : ''}`}
                    onClick={() => setActiveStepTab('events')}
                  >
                    Events
                  </button>
                </div>

                <div className="step-detail-content">
                  {activeStepTab === 'input-output' && (
                    <div className="step-input-output">
                      <div className="step-io-section">
                        <h4>Input</h4>
                        <JsonViewer data={getStepInput(selectedStep)} maxHeight="200px" />
                      </div>
                      <div className="step-io-section">
                        <h4>Output</h4>
                        <JsonViewer data={getStepOutput(selectedStep)} maxHeight="200px" />
                      </div>
                    </div>
                  )}

                  {activeStepTab === 'events' && (
                    <div className="step-events">
                      <div className="step-events-header">
                        <h4>Step Events ({getStepEvents(selectedStep).length} events)</h4>
                      </div>
                      <div className="step-events-table-container">
                        <table className="step-events-table">
                          <thead>
                            <tr>
                              <th className="step-events-expand-col"></th>
                              <th className="step-events-id-col">ID</th>
                              <th className="step-events-type-col">Type</th>
                              <th className="step-events-timestamp-col">Timestamp</th>
                            </tr>
                          </thead>
                          <tbody>
                            {getStepEvents(selectedStep).length === 0 ? (
                              <tr>
                                <td colSpan={4} className="no-step-events">
                                  <p>No events found for this step.</p>
                                </td>
                              </tr>
                            ) : (
                              getStepEvents(selectedStep).map(event => (
                                <StepEventRow
                                  key={event.id}
                                  event={event}
                                  formatDate={formatDate}
                                  formatDuration={formatDuration}
                                />
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {activeStepTab === 'details' && (
                    <div className="step-details-info">
                      <div className="detail-grid">
                        <div className="detail-item">
                          <span className="detail-label">Step Name</span>
                          <span className="detail-value">{selectedStep}</span>
                        </div>
                        <div className="detail-item">
                          <span className="detail-label">Type</span>
                          <span className="detail-value">{getStepType(selectedStep)}</span>
                        </div>
                        <div className="detail-item">
                          <span className="detail-label">Status</span>
                          <span className="detail-value">
                            <span className={`step-status-badge status-${getStepStatus(selectedStep)}`}>
                              {getStepStatus(selectedStep)}
                            </span>
                          </span>
                        </div>
                        <div className="detail-item">
                          <span className="detail-label">Resource</span>
                          <span className="detail-value">{getStepResource(selectedStep)}</span>
                        </div>
                        <div className="detail-item">
                          <span className="detail-label">Duration</span>
                          <span className="detail-value">{getStepDuration(selectedStep)}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {activeStepTab === 'definition' && (
                    <div className="step-definition">
                      {stateMachineDefinition ? (
                        getStepDefinition(selectedStep) ? (
                          <div className="definition-content">
                            <h4>Step Definition: {selectedStep}</h4>
                            <JsonViewer data={getStepDefinition(selectedStep)} maxHeight="400px" />
                          </div>
                        ) : (
                          <div className="no-definition">
                            <h4>Step Definition</h4>
                            <p>No definition found for step "{selectedStep}" in the state machine definition.</p>
                            <p>This might be a synthetic step name or the definition hasn't been loaded yet.</p>
                          </div>
                        )
                      ) : (
                        <div className="no-definition">
                          <h4>Step Definition</h4>
                          <p>State machine definition not loaded. Please load the definition from the main Definition tab first.</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* Main Content Panel - When no step is selected */
              <div className="main-content-panel">
                {activeViewTab === 'overview' && (
                  <div className="overview-content">
                    <h3>Execution Overview</h3>
                    <p>Select a step from the graph to view detailed information, or use the tabs above to view execution input/output, definition, or events.</p>
                    <div className="overview-stats">
                      <div className="stat-item">
                        <span className="stat-label">Total Steps</span>
                        <span className="stat-value">{getUniqueSteps().length}</span>
                      </div>
                      <div className="stat-item">
                        <span className="stat-label">Total Events</span>
                        <span className="stat-value">{history.length}</span>
                      </div>
                      <div className="stat-item">
                        <span className="stat-label">Execution Status</span>
                        <span className="stat-value">
                          <span className={`status-badge status-${execution?.status?.toLowerCase()}`}>
                            {execution?.status}
                          </span>
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {activeViewTab === 'input-output' && (
                  <div className="input-output-content">
                    <h3>Execution Input and Output</h3>
                    <p>Select a step from the graph to view step-specific input/output, or view the overall execution input/output in the Details tab above.</p>
                  </div>
                )}

                {activeViewTab === 'definition' && (
                  <div className="definition-content">
                    <h3>State Machine Definition</h3>
                    {definitionLoading ? (
                      <div className="loading-message">
                        <div className="loading-spinner"></div>
                        <span>Loading state machine definition...</span>
                      </div>
                    ) : definitionError ? (
                      <div className="error-message">
                        <div className="error-icon">⚠️</div>
                        <div className="error-content">
                          <div className="error-title">Failed to Load Definition</div>
                          <div className="error-text">{definitionError}</div>
                          <button
                            onClick={() => execution?.executionArn && loadStateMachineDefinition(execution.executionArn)}
                            className="btn btn-primary"
                          >
                            Retry Loading Definition
                          </button>
                        </div>
                      </div>
                    ) : stateMachineDefinition ? (
                      <div className="definition-viewer">
                        <JsonViewer data={stateMachineDefinition} maxHeight="300px" showLineNumbers={true} />
                      </div>
                    ) : (
                      <div className="no-definition">
                        <p>No state machine definition available. Click a step to view step-specific definition.</p>
                      </div>
                    )}
                  </div>
                )}

                {activeViewTab === 'events' && (
                  <div className="events-content">
                    <h3>Execution Events</h3>
                    <p>All execution events are displayed in the events panel below. Select a step from the graph to view step-specific events.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Panel - Events (300px height - consistent across all tabs) */}
      <div className="execution-events-panel">
        <div className="events-panel-header">
          <div className="events-panel-title">Execution Events</div>
          <div className="events-panel-tabs">
            <button
              className={`events-tab ${activeEventsTab === 'all' ? 'active' : ''}`}
              onClick={() => setActiveEventsTab('all')}
            >
              All Events ({history.length})
            </button>
            <button
              className={`events-tab ${activeEventsTab === 'errors' ? 'active' : ''}`}
              onClick={() => setActiveEventsTab('errors')}
            >
              Errors ({history.filter(e => e.type.toLowerCase().includes('failed') || e.type.toLowerCase().includes('error')).length})
            </button>
          </div>
        </div>

        <div className="events-panel-content">
          <div className="events-filters">
            <input
              type="text"
              placeholder="Filter events..."
              value={eventSearchFilter}
              onChange={(e) => setEventSearchFilter(e.target.value)}
              className="events-filter-input"
            />
            <input
              type="date"
              value={eventDateFilter}
              onChange={(e) => setEventDateFilter(e.target.value)}
              className="events-filter-date"
            />
            <select
              value={eventTypeFilter}
              onChange={(e) => setEventTypeFilter(e.target.value)}
              className="events-filter-select"
            >
              <option value="">All Types</option>
              {uniqueEventTypes.map(type => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </div>

          <div className="events-table-container">
            {loading ? (
              <div className="loading-message">
                <div className="loading-spinner"></div>
                <span>Loading events...</span>
              </div>
            ) : error ? (
              <div className="error-message">
                <div className="error-icon">⚠️</div>
                <div className="error-content">
                  <div className="error-title">Error Loading Events</div>
                  <div className="error-text">{error}</div>
                </div>
              </div>
            ) : filteredEvents.length === 0 ? (
              <div className="no-events">
                <p>No events found matching the current filters.</p>
              </div>
            ) : (
              <table className="events-table">
                <thead>
                  <tr>
                    <th className="events-expand-col"></th>
                    <th className="events-id-col">ID</th>
                    <th className="events-type-col">Type</th>
                    <th className="events-step-col">Step</th>
                    <th className="events-resource-col">Resource</th>
                    <th className="events-timestamp-col">Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEvents.map(event => (
                    <EventRow
                      key={event.id}
                      event={event}
                      formatDate={formatDate}
                      formatDuration={formatDuration}
                      allEvents={history}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* New Execution Modal */}
      {showNewExecutionModal && (
        <div className="modal-overlay" onClick={() => setShowNewExecutionModal(false)}>
          <div className="modal-content new-execution-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Start new execution</h3>
              <button className="modal-close" onClick={() => setShowNewExecutionModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>State machine</label>
                <div className="state-machine-arn">{execution?.stateMachineArn}</div>
              </div>
              <div className="form-group">
                <label>Input (JSON)</label>
                <textarea
                  className="execution-input-textarea"
                  value={newExecutionInput}
                  onChange={e => setNewExecutionInput(e.target.value)}
                  placeholder='{"key": "value"}'
                  rows={10}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="btn btn-secondary"
                onClick={() => setShowNewExecutionModal(false)}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleNewExecution}
                disabled={isStartingExecution}
              >
                {isStartingExecution ? 'Starting...' : 'Start execution'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ExecutionDetails;


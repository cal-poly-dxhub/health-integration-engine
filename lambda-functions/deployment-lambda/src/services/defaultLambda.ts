/**
 * Shared defaults for Lambda nodes deployed without custom code/handler.
 * Handler and generated function name live together here so they can't drift
 * (a Python `lambda_function.lambda_handler` needs both a lambda_function.py file
 * and a `lambda_handler` function, or the runtime fails to import the module).
 */

export interface DefaultLambdaNode {
  id: string;
  name?: string;
}

// Default handler per runtime; module name matches the zip file name and the code below.
export function getDefaultHandler(runtime: string): string {
  if (runtime.includes('python')) {
    return 'lambda_function.lambda_handler';
  } else if (runtime.includes('nodejs')) {
    return 'index.handler';
  } else if (runtime.includes('java')) {
    return 'com.example.Handler::handleRequest';
  } else if (runtime.includes('dotnet')) {
    return 'Assembly::Namespace.ClassName::MethodName';
  }
  // Default to Python, matching the default runtime and the generated code below.
  return 'lambda_function.lambda_handler';
}

// Default Python code; function is named lambda_handler to match getDefaultHandler.
export function getDefaultLambdaCode(node: DefaultLambdaNode): string {
  return `
import json
import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)

def lambda_handler(event, context):
    """
    Default Lambda function for workflow node: ${node.name || node.id}
    """
    logger.info(f"Processing event: {json.dumps(event)}")

    # TODO: Implement your business logic here
    result = {
        'statusCode': 200,
        'body': {
            'message': 'Lambda function executed successfully',
            'nodeId': '${node.id}',
            'nodeName': '${node.name || 'Unnamed'}',
            'input': event
        }
    }

    logger.info(f"Returning result: {json.dumps(result)}")
    return result
  `.trim();
}

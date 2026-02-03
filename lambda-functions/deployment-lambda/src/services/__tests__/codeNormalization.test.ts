/**
 * Test cases for Lambda code normalization
 */

import { CloudFormationTemplateGenerator } from '../cloudFormationTemplateGenerator';

// Access private method for testing
const normalizeLambdaCode = (CloudFormationTemplateGenerator as any).normalizeLambdaCode;

describe('Lambda Code Normalization', () => {
  test('should normalize Python code with mixed indentation', () => {
    const messyPythonCode = `
import json
import re
from datetime import datetime

def lambda_handler(event, context):
"""AWS Lambda function"""
try:
hl7_message = ''
if 'Body' in event:
try:
body_content = json.loads(event['Body'])
hl7_message = body_content.get('hl7_message', '')
except json.JSONDecodeError as e:
return {
'statusCode': 400,
'body': json.dumps({'error': f'Invalid JSON: {str(e)}'})
}
else:
hl7_message = event.get('hl7_message', '')
return {
'statusCode': 200,
'body': json.dumps({'message': 'Success'})
}
except Exception as e:
return {
'statusCode': 500,
'body': json.dumps({'error': str(e)})
}
    `.trim();

    const normalized = normalizeLambdaCode(messyPythonCode, 'python3.9');
    
    // Check that the code has proper indentation
    expect(normalized).toContain('def lambda_handler(event, context):');
    expect(normalized).toContain('    """AWS Lambda function"""');
    expect(normalized).toContain('    try:');
    expect(normalized).toContain('        hl7_message = \'\'');
    expect(normalized).toContain('        if \'Body\' in event:');
    expect(normalized).toContain('            try:');
    
    // Verify no tabs are present
    expect(normalized).not.toContain('\t');
    
    // Verify consistent 4-space indentation
    const lines = normalized.split('\n');
    const indentedLines = lines.filter(line => line.trim() && !line.startsWith('import') && !line.startsWith('from') && !line.startsWith('def lambda_handler'));
    
    indentedLines.forEach(line => {
      const leadingSpaces = line.match(/^ */)?.[0].length || 0;
      expect(leadingSpaces % 4).toBe(0); // Should be multiple of 4
    });
  });

  test('should handle Node.js code without modification', () => {
    const nodeCode = `
exports.handler = async (event) => {
    console.log('Event:', JSON.stringify(event));
    
    try {
        const result = processEvent(event);
        return {
            statusCode: 200,
            body: JSON.stringify(result)
        };
    } catch (error) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};
    `.trim();

    const normalized = normalizeLambdaCode(nodeCode, 'nodejs18.x');
    
    // Node.js code should be minimally changed (just basic cleanup)
    expect(normalized).toContain('exports.handler = async (event) => {');
    expect(normalized).toContain('console.log(\'Event:\', JSON.stringify(event));');
  });

  test('should preserve empty lines and comments', () => {
    const pythonWithComments = `
# This is a comment
import json

def lambda_handler(event, context):
    # Process the event
    result = process_data(event)
    
    # Return response
    return {
        'statusCode': 200,
        'body': json.dumps(result)
    }
    `.trim();

    const normalized = normalizeLambdaCode(pythonWithComments, 'python3.9');
    
    expect(normalized).toContain('# This is a comment');
    expect(normalized).toContain('    # Process the event');
    expect(normalized).toContain('    # Return response');
    
    // Check that empty lines are preserved
    expect(normalized.split('\n')).toContain('');
  });

  test('should handle complex nested structures', () => {
    const complexPython = `
def lambda_handler(event, context):
    try:
        if 'data' in event:
            for item in event['data']:
                if item['type'] == 'process':
                    result = process_item(item)
                    if result:
                        return success_response(result)
                else:
                    continue
        return error_response('No data found')
    except Exception as e:
        return error_response(str(e))
    `.trim();

    const normalized = normalizeLambdaCode(complexPython, 'python3.9');
    
    // Verify nested indentation levels
    expect(normalized).toContain('def lambda_handler(event, context):');
    expect(normalized).toContain('    try:');
    expect(normalized).toContain('        if \'data\' in event:');
    expect(normalized).toContain('            for item in event[\'data\']:');
    expect(normalized).toContain('                if item[\'type\'] == \'process\':');
    expect(normalized).toContain('                    result = process_item(item)');
    expect(normalized).toContain('                    if result:');
    expect(normalized).toContain('                        return success_response(result)');
  });
});
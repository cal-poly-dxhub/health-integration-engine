import json
import re
from datetime import datetime
from typing import Dict, List, Optional, Any

def lambda_handler(event, context):
    """
    AWS Lambda function to parse HL7 messages and extract structured information.

    Expected input formats:
    1. Direct: {"hl7_message": "MSH|^~\\&|..."}
    2. S3 Object: {"Body": "{\"hl7_message\": \"MSH|^~\\&|...\"}"}

    Returns:
    {
        "statusCode": 200,
        "body": {...simplified response...}
    }
    """
    try:
        hl7_message = ''

        # Debug: Print the input event structure
        print(f"📋 Input event keys: {list(event.keys())}")
        print(f"📋 Event type: {type(event)}")

        # Handle Step Functions wrapper format
        actual_input = event
        if 'input' in event and isinstance(event['input'], dict):
            print("📦 Found Step Functions 'input' wrapper, using nested data")
            actual_input = event['input']
            print(f"📋 Actual input keys: {list(actual_input.keys())}")

        # Check for S3 event-triggered workflow: file content is in s3Result.Body
        if 's3Result' in actual_input and 'Body' in actual_input['s3Result']:
            print('📦 Found S3 trigger result, reading file content from s3Result.Body')
            body_raw = actual_input['s3Result']['Body']
            # Try parsing as JSON first (file may be JSON-wrapped)
            try:
                body_json = json.loads(body_raw)
                if isinstance(body_json, dict) and 'hl7_message' in body_json:
                    hl7_message = body_json['hl7_message']
                else:
                    hl7_message = body_raw
            except (json.JSONDecodeError, TypeError):
                hl7_message = body_raw

        # Check if input has Body parameter (S3 object format)
        elif 'Body' in actual_input:
            print("📦 Found 'Body' field in actual input")
            body_raw = actual_input['Body']
            print(f"📋 Body type: {type(body_raw)}")
            print(f"📋 Body content (first 200 chars): {str(body_raw)[:200]}")

            try:
                # Parse the Body as JSON
                body_content = json.loads(body_raw)
                print(f"✅ Successfully parsed Body as JSON")
                print(f"📋 Body JSON keys: {list(body_content.keys()) if isinstance(body_content, dict) else 'Not a dict'}")

                hl7_message = body_content.get('hl7_message', '')
                print(f"📋 HL7 message length from Body: {len(hl7_message)}")

            except json.JSONDecodeError as e:
                print(f"❌ JSON decode error: {str(e)}")
                return {
                    'error': f'Invalid JSON in Body parameter: {str(e)}',
                    'body_content': str(body_raw)[:500]  # First 500 chars for debugging
                }
        else:
            print("📋 No 'Body' field found, checking for direct hl7_message")
            # Direct format - check both original event and actual_input
            hl7_message = actual_input.get('hl7_message', '') or event.get('hl7_message', '')
            print(f"📋 Direct HL7 message length: {len(hl7_message)}")

        if not hl7_message:
            print("❌ No HL7 message found after all checks")
            return {
                'error': 'No hl7_message found in request. Expected either "hl7_message" field or "Body" field containing JSON with "hl7_message"',
                'debug_info': {
                    'event_keys': list(event.keys()),
                    'actual_input_keys': list(actual_input.keys()),
                    'has_body': 'Body' in actual_input,
                    'has_hl7_message': 'hl7_message' in actual_input,
                    'body_preview': str(actual_input.get('Body', 'N/A'))[:200] if 'Body' in actual_input else 'N/A'
                }
            }

        print(f"✅ Found HL7 message, length: {len(hl7_message)}")

        # Parse the HL7 message
        parser = HL7Parser()
        parsed_data = parser.parse(hl7_message)

        # Create simplified response
        simplified_response = parser.create_simplified_response(parsed_data)

        # Return the simplified response directly for Step Functions
        # This makes it easier to use the output in subsequent steps
        return simplified_response

    except Exception as e:
        # return {
        #     'error': f'Error parsing HL7 message: {str(e)}'
        # }
        raise e

class HL7Parser:
    """HL7 Message Parser for extracting structured data from HL7 messages."""

    def __init__(self):
        self.field_separator = '|'
        self.component_separator = '^'
        self.repetition_separator = '~'
        self.escape_character = '\\'
        self.subcomponent_separator = '&'

    def parse(self, hl7_message: str) -> Dict[str, Any]:
        """Parse HL7 message and return structured data."""
        lines = hl7_message.strip().split('\n')
        segments = {}

        for line in lines:
            line = line.strip()
            if not line:
                continue

            segment_data = self.parse_segment(line)
            if segment_data:
                segment_type = segment_data['segment_type']
                if segment_type in segments:
                    # Handle multiple segments of same type
                    if not isinstance(segments[segment_type], list):
                        segments[segment_type] = [segments[segment_type]]
                    segments[segment_type].append(segment_data)
                else:
                    segments[segment_type] = segment_data

        # Extract meaningful information
        extracted_info = self.extract_meaningful_data(segments)

        return {
            'segments': segments,
            'extracted_info': extracted_info
        }

    def parse_segment(self, segment_line: str) -> Optional[Dict[str, Any]]:
        """Parse individual HL7 segment."""
        if len(segment_line) < 3:
            return None

        segment_type = segment_line[:3]
        fields = segment_line.split(self.field_separator)

        segment_data = {
            'segment_type': segment_type,
            'raw': segment_line,
            'fields': fields
        }

        # Parse specific segment types
        if segment_type == 'MSH':
            segment_data.update(self.parse_msh_segment(fields))
        elif segment_type == 'PID':
            segment_data.update(self.parse_pid_segment(fields))
        elif segment_type == 'SCH':
            segment_data.update(self.parse_sch_segment(fields))
        elif segment_type == 'PV1':
            segment_data.update(self.parse_pv1_segment(fields))
        elif segment_type == 'RGS':
            segment_data.update(self.parse_rgs_segment(fields))
        elif segment_type == 'AIG':
            segment_data.update(self.parse_aig_segment(fields))
        elif segment_type == 'AIL':
            segment_data.update(self.parse_ail_segment(fields))
        elif segment_type == 'AIP':
            segment_data.update(self.parse_aip_segment(fields))

        return segment_data

    def parse_msh_segment(self, fields: List[str]) -> Dict[str, Any]:
        """Parse MSH (Message Header) segment."""
        return {
            'sending_application': fields[2] if len(fields) > 2 else '',
            'sending_facility': fields[3] if len(fields) > 3 else '',
            'receiving_application': fields[4] if len(fields) > 4 else '',
            'receiving_facility': fields[5] if len(fields) > 5 else '',
            'timestamp': self.parse_timestamp(fields[6]) if len(fields) > 6 else None,
            'message_type': fields[8] if len(fields) > 8 else '',
            'message_control_id': fields[9] if len(fields) > 9 else '',
            'processing_id': fields[10] if len(fields) > 10 else '',
            'version_id': fields[11] if len(fields) > 11 else ''
        }

    def parse_pid_segment(self, fields: List[str]) -> Dict[str, Any]:
        """Parse PID (Patient Identification) segment."""
        patient_name = self.parse_name_field(fields[5]) if len(fields) > 5 else {}

        return {
            'set_id': fields[1] if len(fields) > 1 else '',
            'patient_id': fields[3] if len(fields) > 3 else '',
            'patient_name': patient_name,
            'birth_date': self.parse_date(fields[7]) if len(fields) > 7 else None,
            'gender': fields[8] if len(fields) > 8 else '',
            'address': self.parse_address_field(fields[11]) if len(fields) > 11 else {},
            'phone': fields[13] if len(fields) > 13 else '',
            'marital_status': fields[16] if len(fields) > 16 else '',
            'ssn': fields[19] if len(fields) > 19 else ''
        }

    def parse_sch_segment(self, fields: List[str]) -> Dict[str, Any]:
        """Parse SCH (Schedule Activity Information) segment."""
        return {
            'placer_appointment_id': fields[1] if len(fields) > 1 else '',
            'filler_appointment_id': fields[2] if len(fields) > 2 else '',
            'appointment_type': fields[6] if len(fields) > 6 else '',
            'appointment_reason': fields[7] if len(fields) > 7 else '',
            'appointment_location': fields[8] if len(fields) > 8 else '',
            'duration': fields[9] if len(fields) > 9 else '',
            'duration_units': fields[10] if len(fields) > 10 else '',
            'scheduled_time': self.parse_appointment_time(fields[11]) if len(fields) > 11 else {},
            'requesting_provider': self.parse_provider_field(fields[16]) if len(fields) > 16 else {},
            'entered_by': self.parse_provider_field(fields[20]) if len(fields) > 20 else {},
            'status': fields[25] if len(fields) > 25 else ''
        }

    def parse_pv1_segment(self, fields: List[str]) -> Dict[str, Any]:
        """Parse PV1 (Patient Visit) segment."""
        return {
            'set_id': fields[1] if len(fields) > 1 else '',
            'patient_class': fields[2] if len(fields) > 2 else '',
            'assigned_patient_location': fields[3] if len(fields) > 3 else '',
            'attending_doctor': self.parse_provider_field(fields[7]) if len(fields) > 7 else {},
            'referring_doctor': self.parse_provider_field(fields[8]) if len(fields) > 8 else {},
            'visit_number': fields[19] if len(fields) > 19 else ''
        }

    def parse_rgs_segment(self, fields: List[str]) -> Dict[str, Any]:
        """Parse RGS (Resource Group) segment."""
        return {
            'set_id': fields[1] if len(fields) > 1 else '',
            'segment_action_code': fields[2] if len(fields) > 2 else ''
        }

    def parse_aig_segment(self, fields: List[str]) -> Dict[str, Any]:
        """Parse AIG (Appointment Information - General Resource) segment."""
        return {
            'set_id': fields[1] if len(fields) > 1 else '',
            'segment_action_code': fields[2] if len(fields) > 2 else '',
            'resource_id': fields[3] if len(fields) > 3 else '',
            'resource_type': fields[4] if len(fields) > 4 else ''
        }

    def parse_ail_segment(self, fields: List[str]) -> Dict[str, Any]:
        """Parse AIL (Appointment Information - Location Resource) segment."""
        return {
            'set_id': fields[1] if len(fields) > 1 else '',
            'segment_action_code': fields[2] if len(fields) > 2 else '',
            'location_resource_id': fields[3] if len(fields) > 3 else '',
            'location_type': fields[4] if len(fields) > 4 else '',
            'location_group': fields[5] if len(fields) > 5 else '',
            'start_date_time': self.parse_timestamp(fields[6]) if len(fields) > 6 else None,
            'duration': fields[9] if len(fields) > 9 else '',
            'duration_units': fields[10] if len(fields) > 10 else '',
            'status': fields[12] if len(fields) > 12 else ''
        }

    def parse_aip_segment(self, fields: List[str]) -> Dict[str, Any]:
        """Parse AIP (Appointment Information - Personnel Resource) segment."""
        return {
            'set_id': fields[1] if len(fields) > 1 else '',
            'segment_action_code': fields[2] if len(fields) > 2 else '',
            'personnel_resource_id': self.parse_provider_field(fields[3]) if len(fields) > 3 else {},
            'resource_type': fields[4] if len(fields) > 4 else '',
            'resource_group': fields[5] if len(fields) > 5 else '',
            'start_date_time': self.parse_timestamp(fields[6]) if len(fields) > 6 else None,
            'duration': fields[9] if len(fields) > 9 else '',
            'duration_units': fields[10] if len(fields) > 10 else '',
            'status': fields[12] if len(fields) > 12 else ''
        }

    def parse_name_field(self, name_field: str) -> Dict[str, str]:
        """Parse HL7 name field (last^first^middle^suffix^prefix)."""
        if not name_field:
            return {}

        components = name_field.split(self.component_separator)
        return {
            'last_name': components[0] if len(components) > 0 else '',
            'first_name': components[1] if len(components) > 1 else '',
            'middle_name': components[2] if len(components) > 2 else '',
            'suffix': components[3] if len(components) > 3 else '',
            'prefix': components[4] if len(components) > 4 else '',
            'full_name': f"{components[1] if len(components) > 1 else ''} {components[0] if len(components) > 0 else ''}".strip()
        }

    def parse_provider_field(self, provider_field: str) -> Dict[str, str]:
        """Parse HL7 provider field (id^last^first^middle^suffix^prefix^degree)."""
        if not provider_field:
            return {}

        components = provider_field.split(self.component_separator)
        return {
            'id': components[0] if len(components) > 0 else '',
            'last_name': components[1] if len(components) > 1 else '',
            'first_name': components[2] if len(components) > 2 else '',
            'middle_name': components[3] if len(components) > 3 else '',
            'suffix': components[4] if len(components) > 4 else '',
            'prefix': components[5] if len(components) > 5 else '',
            'degree': components[6] if len(components) > 6 else '',
            'full_name': f"{components[2] if len(components) > 2 else ''} {components[1] if len(components) > 1 else ''}".strip()
        }

    def parse_address_field(self, address_field: str) -> Dict[str, str]:
        """Parse HL7 address field."""
        if not address_field:
            return {}

        components = address_field.split(self.component_separator)
        return {
            'street': components[0] if len(components) > 0 else '',
            'other_designation': components[1] if len(components) > 1 else '',
            'city': components[2] if len(components) > 2 else '',
            'state': components[3] if len(components) > 3 else '',
            'zip': components[4] if len(components) > 4 else '',
            'country': components[5] if len(components) > 5 else ''
        }

    def parse_appointment_time(self, time_field: str) -> Dict[str, Any]:
        """Parse HL7 appointment time field."""
        if not time_field:
            return {}

        components = time_field.split(self.component_separator)
        return {
            'duration': components[2] if len(components) > 2 else '',
            'start_time': self.parse_timestamp(components[3]) if len(components) > 3 else None,
            'end_time': self.parse_timestamp(components[4]) if len(components) > 4 else None
        }

    def parse_timestamp(self, timestamp_str: str) -> Optional[datetime]:
        """Parse HL7 timestamp format (YYYYMMDDHHMMSS)."""
        if not timestamp_str or len(timestamp_str) < 8:
            return None

        try:
            # Handle different timestamp formats
            if len(timestamp_str) >= 14:
                return datetime.strptime(timestamp_str[:14], '%Y%m%d%H%M%S')
            elif len(timestamp_str) >= 12:
                return datetime.strptime(timestamp_str[:12], '%Y%m%d%H%M')
            elif len(timestamp_str) >= 8:
                return datetime.strptime(timestamp_str[:8], '%Y%m%d')
        except ValueError:
            return None

        return None

    def parse_date(self, date_str: str) -> Optional[datetime]:
        """Parse HL7 date format (YYYYMMDD)."""
        if not date_str or len(date_str) < 8:
            return None

        try:
            return datetime.strptime(date_str[:8], '%Y%m%d')
        except ValueError:
            return None

    def extract_meaningful_data(self, segments: Dict[str, Any]) -> Dict[str, Any]:
        """Extract meaningful, human-readable information from parsed segments."""
        extracted = {}

        # Message information
        if 'MSH' in segments:
            msh = segments['MSH']
            extracted['message_info'] = {
                'type': 'Scheduling Information Update (SIU^S12)',
                'timestamp': msh.get('timestamp'),
                'control_id': msh.get('message_control_id'),
                'sending_system': msh.get('sending_application'),
                'receiving_system': msh.get('receiving_application')
            }

        # Patient information
        if 'PID' in segments:
            pid = segments['PID']
            extracted['patient'] = {
                'id': pid.get('patient_id'),
                'name': pid.get('patient_name', {}).get('full_name'),
                'birth_date': pid.get('birth_date'),
                'gender': 'Male' if pid.get('gender') == 'M' else 'Female' if pid.get('gender') == 'F' else pid.get('gender'),
                'phone': pid.get('phone'),
                'address': pid.get('address'),
                'marital_status': pid.get('marital_status')
            }

        # Appointment information
        if 'SCH' in segments:
            sch = segments['SCH']
            extracted['appointment'] = {
                'id': sch.get('placer_appointment_id'),
                'type': sch.get('appointment_type'),
                'reason': sch.get('appointment_reason'),
                'location': sch.get('appointment_location'),
                'duration': f"{sch.get('duration')} {sch.get('duration_units')}",
                'scheduled_time': sch.get('scheduled_time'),
                'provider': sch.get('requesting_provider', {}).get('full_name'),
                'status': sch.get('status', 'Scheduled')
            }

        # Visit information
        if 'PV1' in segments:
            pv1 = segments['PV1']
            extracted['visit'] = {
                'class': 'Outpatient' if pv1.get('patient_class') == 'O' else pv1.get('patient_class'),
                'location': pv1.get('assigned_patient_location'),
                'attending_doctor': pv1.get('attending_doctor', {}).get('full_name'),
                'referring_doctor': pv1.get('referring_doctor', {}).get('full_name')
            }

        # Resource information
        resources = []
        if 'AIL' in segments:
            ail = segments['AIL'] if isinstance(segments['AIL'], list) else [segments['AIL']]
            for resource in ail:
                resources.append({
                    'type': 'Location',
                    'id': resource.get('location_resource_id'),
                    'description': resource.get('location_type'),
                    'status': resource.get('status')
                })

        if 'AIP' in segments:
            aip = segments['AIP'] if isinstance(segments['AIP'], list) else [segments['AIP']]
            for resource in aip:
                resources.append({
                    'type': 'Personnel',
                    'name': resource.get('personnel_resource_id', {}).get('full_name'),
                    'id': resource.get('personnel_resource_id', {}).get('id'),
                    'status': resource.get('status')
                })

        if resources:
            extracted['resources'] = resources

        return extracted

    def create_simplified_response(self, parsed_data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a simplified, clean response with just the essential information."""
        extracted_info = parsed_data.get('extracted_info', {})
        simplified = {}

        # Patient information
        if 'patient' in extracted_info:
            patient = extracted_info['patient']
            simplified['Patient'] = patient.get('name', '')
            simplified['ID'] = patient.get('id', '')

            # Format birth date nicely
            birth_date = patient.get('birth_date')
            if birth_date:
                if isinstance(birth_date, str):
                    # Remove time part if present
                    simplified['Birth_Date'] = birth_date.split(' ')[0]
                else:
                    simplified['Birth_Date'] = str(birth_date).split(' ')[0]
            else:
                simplified['Birth_Date'] = ''

            # Format gender
            gender = patient.get('gender', '')
            if gender == 'M':
                simplified['Gender'] = 'Male'
            elif gender == 'F':
                simplified['Gender'] = 'Female'
            else:
                simplified['Gender'] = gender

            simplified['Phone'] = patient.get('phone', '')

            # Format address
            address = patient.get('address', {})
            if address:
                address_parts = []
                if address.get('street'):
                    address_parts.append(address['street'])
                if address.get('city'):
                    address_parts.append(address['city'])
                if address.get('state'):
                    address_parts.append(address['state'])
                if address.get('zip'):
                    address_parts.append(address['zip'])
                simplified['Address'] = ', '.join(address_parts)
            else:
                simplified['Address'] = ''

        # Appointment information
        if 'appointment' in extracted_info:
            appt = extracted_info['appointment']
            simplified['Appointment_ID'] = appt.get('id', '')
            simplified['Type'] = appt.get('type', '')
            simplified['Reason'] = appt.get('reason', '')
            simplified['Location'] = appt.get('location', '')
            simplified['Duration'] = appt.get('duration', '')
            simplified['Provider'] = appt.get('provider', '')
            simplified['Status'] = appt.get('status', '')

            # Add scheduled time if available
            scheduled_time = appt.get('scheduled_time', {})
            if scheduled_time:
                start_time = scheduled_time.get('start_time')
                end_time = scheduled_time.get('end_time')
                if start_time and end_time:
                    simplified['Scheduled_Time'] = f"{start_time} - {end_time}"
                elif start_time:
                    simplified['Scheduled_Time'] = str(start_time)

        # Visit information
        if 'visit' in extracted_info:
            visit = extracted_info['visit']
            if visit.get('attending_doctor'):
                simplified['Attending_Doctor'] = visit['attending_doctor']
            if visit.get('referring_doctor'):
                simplified['Referring_Doctor'] = visit['referring_doctor']
            if visit.get('class'):
                simplified['Visit_Class'] = visit['class']

        # Message information
        if 'message_info' in extracted_info:
            msg_info = extracted_info['message_info']
            simplified['Message_Type'] = msg_info.get('type', '')
            simplified['Message_Timestamp'] = str(msg_info.get('timestamp', ''))
            simplified['Control_ID'] = msg_info.get('control_id', '')

        return simplified

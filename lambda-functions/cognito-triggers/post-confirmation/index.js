/**
 * Cognito Post Confirmation Trigger
 * This function is triggered after a user is confirmed during the sign-up process.
 * It can be used to initialize user data, send welcome emails, or perform post-registration tasks.
 */

const AWS = require('aws-sdk');
const cognito = new AWS.CognitoIdentityServiceProvider();

exports.handler = async (event) => {
    console.log('Post Confirmation trigger event:', JSON.stringify(event, null, 2));
    
    try {
        const { userPoolId, userName } = event;
        const { userAttributes } = event.request;
        
        // Update user attributes with additional metadata
        const updateParams = {
            UserPoolId: userPoolId,
            Username: userName,
            UserAttributes: [
                {
                    Name: 'custom:registration_date',
                    Value: new Date().toISOString()
                },
                {
                    Name: 'custom:account_status',
                    Value: 'active'
                }
            ]
        };
        
        // Add organization if not already set
        if (!userAttributes['custom:organization']) {
            updateParams.UserAttributes.push({
                Name: 'custom:organization',
                Value: 'default'
            });
        }
        
        // Update user attributes
        await cognito.adminUpdateUserAttributes(updateParams).promise();
        
        // Add user to default group based on role
        const userRole = userAttributes['custom:user_role'] || 'user';
        const groupName = userRole === 'admin' ? 'Administrators' : 'Users';
        
        try {
            await cognito.adminAddUserToGroup({
                UserPoolId: userPoolId,
                Username: userName,
                GroupName: groupName
            }).promise();
            
            console.log(`User ${userName} added to group ${groupName}`);
        } catch (groupError) {
            // Group might not exist yet, log but don't fail
            console.warn(`Could not add user to group ${groupName}:`, groupError.message);
        }
        
        // Log successful user registration
        console.log(`User ${userName} successfully confirmed and initialized`);
        
        // Send welcome notification (if needed)
        if (process.env.SEND_WELCOME_EMAIL === 'true') {
            await sendWelcomeNotification(userAttributes.email, userName);
        }
        
        return event;
        
    } catch (error) {
        console.error('Post Confirmation trigger error:', error);
        // Don't throw error to avoid blocking user confirmation
        return event;
    }
};

async function sendWelcomeNotification(email, username) {
    try {
        // This would integrate with SES or SNS for sending welcome emails
        console.log(`Welcome notification would be sent to ${email} for user ${username}`);
        
        // Example SES integration (commented out):
        /*
        const ses = new AWS.SES();
        const params = {
            Destination: {
                ToAddresses: [email]
            },
            Message: {
                Body: {
                    Html: {
                        Data: `
                            <h1>Welcome to Workflow Builder!</h1>
                            <p>Hello ${username},</p>
                            <p>Your account has been successfully created. You can now start building workflows.</p>
                        `
                    }
                },
                Subject: {
                    Data: 'Welcome to Workflow Builder'
                }
            },
            Source: 'noreply@workflow-builder.com'
        };
        
        await ses.sendEmail(params).promise();
        */
        
    } catch (error) {
        console.error('Error sending welcome notification:', error);
    }
}
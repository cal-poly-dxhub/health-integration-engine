/**
 * Cognito Pre Sign-up Trigger
 * This function is triggered before a user is confirmed during the sign-up process.
 * It can be used to validate user attributes, auto-confirm users, or perform custom logic.
 */

exports.handler = async (event) => {
    console.log('Pre Sign-up trigger event:', JSON.stringify(event, null, 2));
    
    try {
        // Extract user attributes
        const { userAttributes } = event.request;
        const email = userAttributes.email;
        const userRole = userAttributes['custom:user_role'] || 'user';
        
        // Validate email domain (optional - customize as needed)
        if (email) {
            const emailDomain = email.split('@')[1];
            const allowedDomains = process.env.ALLOWED_EMAIL_DOMAINS?.split(',') || [];
            
            if (allowedDomains.length > 0 && !allowedDomains.includes(emailDomain)) {
                throw new Error(`Email domain ${emailDomain} is not allowed`);
            }
        }
        
        // Auto-confirm users for specific domains or conditions
        if (process.env.AUTO_CONFIRM_USERS === 'true') {
            event.response.autoConfirmUser = true;
            event.response.autoVerifyEmail = true;
        }
        
        // Set default user attributes
        if (!userAttributes['custom:user_role']) {
            event.response.userAttributes = {
                ...event.response.userAttributes,
                'custom:user_role': 'user'
            };
        }
        
        console.log('Pre Sign-up processing completed successfully');
        return event;
        
    } catch (error) {
        console.error('Pre Sign-up trigger error:', error);
        throw error;
    }
};
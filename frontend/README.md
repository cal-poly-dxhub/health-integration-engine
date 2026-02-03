# Frontend - AWS Message Router Solution

React TypeScript frontend application built with Vite.

## Features

- React 18 with TypeScript
- Vite for fast development and building
- Redux Toolkit for state management
- React Router for navigation
- AWS Amplify for Cognito authentication
- React DnD for drag-and-drop functionality
- Monaco Editor for code editing
- ESLint and Prettier for code quality

## Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Lint code
npm run lint

# Format code
npm run format
```

## Project Structure

```
src/
├── components/          # React components
│   ├── auth/           # Authentication components
│   ├── dashboard/      # Dashboard components
│   ├── editor/         # Visual editor components
│   ├── modals/         # Modal components
│   └── common/         # Common/shared components
├── hooks/              # Custom React hooks
├── services/           # API and service layer
├── store/              # Redux store and slices
├── types/              # TypeScript type definitions
├── App.tsx             # Main App component
└── main.tsx            # Application entry point
```

## Environment Variables

Copy `.env.example` to `.env` and configure:

- `VITE_AWS_REGION` - AWS region
- `VITE_COGNITO_USER_POOL_ID` - Cognito User Pool ID
- `VITE_COGNITO_CLIENT_ID` - Cognito Client ID
- `VITE_API_GATEWAY_URL` - API Gateway URL
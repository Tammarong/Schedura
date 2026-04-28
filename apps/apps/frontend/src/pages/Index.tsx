import { Navigate } from 'react-router-dom';

// Redirect to login since we have a proper auth flow
const Index = () => {
  return <Navigate to="/login" replace />;
};

export default Index;

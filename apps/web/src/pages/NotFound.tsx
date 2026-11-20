import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <div className="card mx-auto max-w-md p-8 text-center">
      <p className="display text-6xl text-pitch-500">404</p>
      <p className="mt-2">That page went out for a throw-in and never came back.</p>
      <Link to="/" className="btn-primary mt-6">
        Back to home
      </Link>
    </div>
  );
}

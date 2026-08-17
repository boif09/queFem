import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout.jsx';
import { FontsPage } from './pages/FontsPage.jsx';
import { HomePage } from './pages/HomePage.jsx';
import { NotFoundPage } from './pages/NotFoundPage.jsx';
import { PlanDetailPage } from './pages/PlanDetailPage.jsx';
import { PlansPage } from './pages/PlansPage.jsx';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="plans" element={<PlansPage />} />
          <Route path="plans/:id" element={<PlanDetailPage />} />
          <Route path="fonts" element={<FontsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

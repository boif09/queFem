import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout.jsx';
import { FontsPage } from './pages/FontsPage.jsx';
import { HomePage } from './pages/HomePage.jsx';
import { NotFoundPage } from './pages/NotFoundPage.jsx';
import { PlanDetailPage } from './pages/PlanDetailPage.jsx';
import { PlansPage } from './pages/PlansPage.jsx';
import { ContactPage, LegalNoticePage, PrivacyPage, StoragePage } from './pages/LegalPages.jsx';

export function AppRoutes() {
  return (
    <Routes>
        <Route element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="plans" element={<PlansPage />} />
          <Route path="plans/:id" element={<PlanDetailPage />} />
          <Route path="fonts" element={<FontsPage />} />
          <Route path="legal" element={<LegalNoticePage />} />
          <Route path="privacitat" element={<PrivacyPage />} />
          <Route path="privacidad" element={<PrivacyPage />} />
          <Route path="emmagatzematge" element={<StoragePage />} />
          <Route path="almacenamiento" element={<StoragePage />} />
          <Route path="contacte" element={<ContactPage />} />
          <Route path="contacto" element={<ContactPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}

import { Outlet } from "react-router-dom";
import { Header } from "./Header.jsx";
import { Footer } from "./Footer.jsx";
import { CartDrawer } from "./CartDrawer.jsx";
import { CartConflictModal } from "../CartConflictModal.jsx";
import { AnnouncementPopup } from "../AnnouncementPopup.jsx";

export function PublicLayout() {
  return (
    <div className="flex min-h-dvh flex-col">
      <Header />
      <main className="flex-1">
        <Outlet />
      </main>
      <Footer />
      <CartDrawer />
      <CartConflictModal />
      <AnnouncementPopup />
    </div>
  );
}

export default PublicLayout;

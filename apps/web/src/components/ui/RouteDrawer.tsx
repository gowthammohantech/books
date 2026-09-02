import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";

import { PageHeader } from "@context/PageHeaderContext";
import { isDrawerPath } from "@/routes/drawerRoutes";
import useDrawerRoute from "@hooks/useDrawerRoute";
import Drawer, { type DrawerWidth } from "./Drawer";
import FormActions from "./FormActions";

export interface RouteDrawerProps {
  title: ReactNode;
  description?: ReactNode;
  /**
   * The form's Cancel / Save buttons. Rendered in the drawer footer on a
   * create route and in the global top bar otherwise, so they must not depend
   * on where they sit — submit via `form="<id>"` rather than a click handler
   * that reaches into the form.
   */
  actions?: ReactNode;
  /** Extra controls in the drawer header / top bar, left of the actions. */
  headerActions?: ReactNode;
  confirmOnClose?: boolean;
  width?: DrawerWidth;
  padded?: boolean;
  children: ReactNode;
}

/**
 * Presents a create screen as a right-side drawer, or as an ordinary page.
 *
 * Six of the create screens are the same component as their edit screen
 * (ContactForm, CreateTaxRate, RecurringScheduleForm, ProductForm, and the
 * customer and vehicle forms). Only the create route is a drawer — editing an
 * invoice is still a full page — so the presentation has to follow the route,
 * not the component. Everything inside is identical either way.
 */
const RouteDrawer = ({
  title,
  description,
  actions,
  headerActions,
  confirmOnClose = false,
  width,
  padded = true,
  children,
}: RouteDrawerProps) => {
  const location = useLocation();
  const { close } = useDrawerRoute();
  const asDrawer = isDrawerPath(location.pathname);

  if (!asDrawer) {
    return (
      <div>
        <PageHeader title={title}>{actions}</PageHeader>
        {children}
      </div>
    );
  }

  return (
    <Drawer
      isOpen
      onClose={close}
      title={title}
      description={description}
      headerActions={headerActions}
      confirmOnClose={confirmOnClose}
      width={width}
      padded={padded}
      footer={actions ? <FormActions>{actions}</FormActions> : undefined}
    >
      {children}
    </Drawer>
  );
};

export default RouteDrawer;

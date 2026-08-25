import { Toaster } from "sonner";
import AppRoutes from './routes/AppRoutes';
import type { AppDispatch, RootState } from './store';
import { useDispatch, useSelector } from 'react-redux';
import { useEffect, useState } from 'react';
import { hydrateFromStorage, fetchSystemSettings } from '@store/systemSettingsSlice';
import { SetupStatusProvider } from '@context/SetupStatusContext';

function App() {
  const dispatch: AppDispatch = useDispatch();
  const { token } = useSelector((state: RootState) => state.auth);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    //localStorage.removeItem('systemSettings'); //for debug purpose
    dispatch(hydrateFromStorage())
      .unwrap()
      .then(() => {
        if (token) {
          return dispatch(fetchSystemSettings(token));
        }
      })
      .finally(() => {
        setHydrated(true);
      });
  }, [dispatch, token]);

  // Block rendering until hydration done
  if (!hydrated) {
    return (
      <></>
      // <div className="flex items-center justify-center h-screen">
      //   <div className='text-center text-2xl font-bold'><Loader2Icon className='animate-spin text-purple-600 h-10 w-10' /></div>
      // </div>
    );
  }

  return (
    <>
      <SetupStatusProvider>
        <AppRoutes />
      </SetupStatusProvider>
      <Toaster position="top-right" richColors />
    </>
  );
}

export default App;

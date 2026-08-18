import { configureStore } from '@reduxjs/toolkit';
import authReducer from './auth/authSlice';
import systemReducer from './systemSettingsSlice';
export const store = configureStore({
  reducer: {
    auth: authReducer,
    systemSettings: systemReducer
  },
  devTools: true,
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
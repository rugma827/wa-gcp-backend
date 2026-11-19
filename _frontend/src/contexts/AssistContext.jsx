import { createContext, useContext, useRef, useState } from 'react';

const AssistContext = createContext();

export function AssistProvider({ children }) {
  const [messages, setMessages] = useState([]);
  const [activityRefreshKey, setActivityRefreshKey] = useState(0);
  const pendingParamsRef = useRef({});
  const pendingIntentRef = useRef(null);

  return (
    <AssistContext.Provider value={{
      messages, setMessages,
      activityRefreshKey, setActivityRefreshKey,
      pendingParamsRef, pendingIntentRef,
    }}>
      {children}
    </AssistContext.Provider>
  );
}

export const useAssist = () => useContext(AssistContext);

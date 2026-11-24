interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{outcome:"accepted"|"dismissed"}>;
}
export function setupPwa(): void {
  if (!/^https?:$/.test(location.protocol)) return;
  let deferred: InstallPrompt | undefined;
  const button=document.getElementById("install-app") as HTMLButtonElement;
  window.addEventListener("beforeinstallprompt",event=>{
    event.preventDefault();deferred=event as InstallPrompt;button.hidden=false;
  });
  button.onclick=async()=>{
    if(!deferred)return;
    await deferred.prompt();await deferred.userChoice;deferred=undefined;button.hidden=true;
  };
  window.addEventListener("appinstalled",()=>{button.hidden=true;});
  if("serviceWorker" in navigator) window.addEventListener("load",()=>{
    void navigator.serviceWorker.register("./sw.js",{scope:"./"}).catch(error=>console.warn("Offline installation is unavailable",error));
  });
}

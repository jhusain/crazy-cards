import { invitationFromHash, type Invitation } from "./network-protocol.ts";

interface InvitationBrowser {
  location: { href: string };
  addEventListener(type: "hashchange", listener: () => void): void;
  launchQueue?: { setConsumer(consumer: (launch: { targetURL?: string }) => void): void };
}

/** Handle cold launches and invitations delivered to an already running PWA. */
export function setupInvitationLinks(onInvitation: (invite: Invitation) => void, browser: InvitationBrowser = window): void {
  const receive = (href: string) => {
    let url: URL;
    try { url = new URL(href); } catch { return; }
    const current = new URL(browser.location.href);
    const scope = new URL("./", current);
    if (url.origin !== scope.origin || url.pathname !== scope.pathname && url.pathname !== scope.pathname + "index.html") return;
    const invite = invitationFromHash(url.hash);
    if (invite) onInvitation(invite);
  };
  browser.addEventListener("hashchange", () => receive(browser.location.href));
  browser.launchQueue?.setConsumer(launch => {
    if (launch.targetURL) receive(launch.targetURL);
  });
  receive(browser.location.href);
}

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
  if("serviceWorker" in navigator) {
    const register = () => {
      void navigator.serviceWorker.register("./sw.js",{scope:"./",updateViaCache:"none"})
        .catch(error=>console.warn("Offline installation is unavailable",error));
    };
    if(document.readyState === "complete") register();
    else window.addEventListener("load", register, {once:true});
  }
}

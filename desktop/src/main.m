#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>

@interface H2FAppDelegate : NSObject <NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, WKDownloadDelegate>
@property NSWindow *window;
@property WKWebView *webView;
@property NSStatusItem *statusItem;
@property NSTask *process;
@property NSPipe *inputPipe;
@property NSPipe *outputPipe;
@property NSPipe *errorPipe;
@property NSMutableData *outputBuffer;
@property NSURL *serviceURL;
@property NSString *serviceToken;
@property NSString *dataDirectory;
@property BOOL quitting;
@property BOOL restarting;
@property NSInteger crashCount;
@property NSDate *lastReadyAt;
@property NSMutableSet<NSString *> *pendingPairIDs;
@end

@implementation H2FAppDelegate
- (NSString *)engineRoot { return [NSBundle.mainBundle.resourcePath stringByAppendingPathComponent:@"engine"]; }
- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    NSString *bundleID = @"com.hhagain.HTMLToFigmaCapture";
    for (NSRunningApplication *other in [NSRunningApplication runningApplicationsWithBundleIdentifier:bundleID]) {
        if (other.processIdentifier != NSProcessInfo.processInfo.processIdentifier) { [other activateWithOptions:NSApplicationActivateAllWindows|NSApplicationActivateIgnoringOtherApps]; [NSApp terminate:nil]; return; }
    }
    self.pendingPairIDs=[NSMutableSet set];
    self.dataDirectory = [NSSearchPathForDirectoriesInDomains(NSApplicationSupportDirectory, NSUserDomainMask, YES).firstObject stringByAppendingPathComponent:@"HTML to Figma Capture"];
    [NSApp setActivationPolicy:NSApplicationActivationPolicyRegular]; [self setupMenu]; [self setupWindow]; [self setupStatusItem]; [self startEngine]; [NSApp activateIgnoringOtherApps:YES];
}
- (NSMenuItem *)item:(NSString *)title action:(SEL)action key:(NSString *)key { NSMenuItem *item=[[NSMenuItem alloc] initWithTitle:title action:action keyEquivalent:key]; item.target=self;return item; }
- (void)setupMenu {
    NSMenu *bar=[NSMenu new], *appMenu=[NSMenu new], *viewMenu=[[NSMenu alloc] initWithTitle:@"视图"], *editMenu=[[NSMenu alloc] initWithTitle:@"编辑"];
    NSMenuItem *appItem=[NSMenuItem new], *editItem=[NSMenuItem new], *viewItem=[NSMenuItem new]; [bar addItem:appItem];[bar addItem:editItem];[bar addItem:viewItem];appItem.submenu=appMenu;editItem.submenu=editMenu;viewItem.submenu=viewMenu;
    [appMenu addItem:[self item:@"关于 HTML to Figma 捕获助手" action:@selector(showAbout:) key:@""]];[appMenu addItem:NSMenuItem.separatorItem];
    [appMenu addItem:[self item:@"显示捕获助手" action:@selector(showWindow:) key:@"0"]];[appMenu addItem:[self item:@"显示 Figma 插件" action:@selector(showPlugin:) key:@""]];[appMenu addItem:NSMenuItem.separatorItem];
    NSMenuItem *hide=[[NSMenuItem alloc] initWithTitle:@"隐藏助手" action:@selector(hide:) keyEquivalent:@"h"];hide.target=NSApp;[appMenu addItem:hide];
    [appMenu addItem:[self item:@"退出捕获助手" action:@selector(quitApp:) key:@"q"]];
    for (NSArray *entry in @[@[@"撤销",@"undo:",@"z"],@[@"剪切",@"cut:",@"x"],@[@"复制",@"copy:",@"c"],@[@"粘贴",@"paste:",@"v"],@[@"全选",@"selectAll:",@"a"]]) { [editMenu addItem:[[NSMenuItem alloc] initWithTitle:entry[0] action:NSSelectorFromString(entry[1]) keyEquivalent:entry[2]]]; }
    [viewMenu addItem:[self item:@"助手首页" action:@selector(showHome:) key:@"1"]];[viewMenu addItem:[self item:@"捕获工作台" action:@selector(openWorkbench:) key:@"2"]];[viewMenu addItem:[self item:@"重新加载" action:@selector(reloadView:) key:@"r"]];NSApp.mainMenu=bar;
}
- (void)setupWindow {
    self.window=[[NSWindow alloc] initWithContentRect:NSMakeRect(0,0,1040,760) styleMask:NSWindowStyleMaskTitled|NSWindowStyleMaskClosable|NSWindowStyleMaskMiniaturizable|NSWindowStyleMaskResizable backing:NSBackingStoreBuffered defer:NO];self.window.title=@"HTML to Figma 捕获助手";self.window.minSize=NSMakeSize(840,650);self.window.releasedWhenClosed=NO;[self.window center];
    WKWebViewConfiguration *config=[WKWebViewConfiguration new];config.websiteDataStore=WKWebsiteDataStore.nonPersistentDataStore;[config.userContentController addScriptMessageHandler:self name:@"assistant"];
    self.webView=[[WKWebView alloc] initWithFrame:NSZeroRect configuration:config];self.webView.navigationDelegate=self;self.webView.UIDelegate=self;self.webView.translatesAutoresizingMaskIntoConstraints=NO;
    NSView *content=[NSView new];self.window.contentView=content;[content addSubview:self.webView];[NSLayoutConstraint activateConstraints:@[[self.webView.topAnchor constraintEqualToAnchor:content.topAnchor],[self.webView.bottomAnchor constraintEqualToAnchor:content.bottomAnchor],[self.webView.leadingAnchor constraintEqualToAnchor:content.leadingAnchor],[self.webView.trailingAnchor constraintEqualToAnchor:content.trailingAnchor]]];
    [self showLoading:@"正在启动捕获助手" detail:@"正在准备内置浏览器和本地捕获服务。"];[self.window makeKeyAndOrderFront:nil];
}
- (void)setupStatusItem {
    self.statusItem=[NSStatusBar.systemStatusBar statusItemWithLength:NSSquareStatusItemLength];NSImage *icon=[[NSImage alloc] initWithContentsOfFile:[NSBundle.mainBundle.resourcePath stringByAppendingPathComponent:@"StatusIcon.png"]];icon.size=NSMakeSize(18,18);icon.template=YES;self.statusItem.button.image=icon;self.statusItem.button.accessibilityLabel=@"HTML to Figma 捕获助手";self.statusItem.button.toolTip=@"HTML to Figma 捕获助手";
    NSMenu *menu=[NSMenu new];[menu addItem:[self item:@"显示捕获助手" action:@selector(showWindow:) key:@""]];[menu addItem:[self item:@"打开捕获工作台" action:@selector(openWorkbench:) key:@""]];[menu addItem:[self item:@"显示 Figma 插件" action:@selector(showPlugin:) key:@""]];[menu addItem:NSMenuItem.separatorItem];[menu addItem:[self item:@"重新启动捕获服务" action:@selector(restartEngine:) key:@""]];[menu addItem:[self item:@"退出捕获助手" action:@selector(quitApp:) key:@""]];self.statusItem.menu=menu;
}
- (void)showLoading:(NSString *)title detail:(NSString *)detail {
    NSString *t=[title stringByReplacingOccurrencesOfString:@"<" withString:@"&lt;"],*d=[detail stringByReplacingOccurrencesOfString:@"<" withString:@"&lt;"];
    [self.webView loadHTMLString:[NSString stringWithFormat:@"<html><meta charset='utf-8'><body style='margin:0;background:#f5f7f5;font:14px/1.8 -apple-system;color:#284b38;display:grid;place-items:center;height:100vh'><div style='max-width:580px;padding:40px'><h2>%@</h2><p>%@</p></div></body></html>",t,d] baseURL:nil];
}
- (void)startEngine {
    NSError *error=nil;[[NSFileManager defaultManager] createDirectoryAtPath:self.dataDirectory withIntermediateDirectories:YES attributes:@{NSFilePosixPermissions:@0700} error:&error];
    NSString *node=[NSBundle.mainBundle.resourcePath stringByAppendingPathComponent:@"runtime/node"],*browser=[NSBundle.mainBundle.resourcePath stringByAppendingPathComponent:@"browser/chrome-headless-shell"];
    if(error||![[NSFileManager defaultManager] isExecutableFileAtPath:node]||![[NSFileManager defaultManager] isExecutableFileAtPath:browser]) { [self showLoading:@"捕获服务未启动" detail:error.localizedDescription?:@"应用内置环境不完整，请完整解压应用包后重试。"];return; }
    NSTask *child=[NSTask new];child.executableURL=[NSURL fileURLWithPath:node];child.currentDirectoryURL=[NSURL fileURLWithPath:self.engineRoot];child.arguments=@[[self.engineRoot stringByAppendingPathComponent:@"scripts/desktop-service.mjs"],@"--data-dir",self.dataDirectory];
    NSMutableDictionary *env=[NSProcessInfo.processInfo.environment mutableCopy];env[@"H2F_CHROME_PATH"]=browser;env[@"H2F_DESKTOP"]=@"1";env[@"PATH"]=@"/usr/bin:/bin:/usr/sbin:/sbin";[env removeObjectForKey:@"NODE_OPTIONS"];[env removeObjectForKey:@"NODE_PATH"];child.environment=env;
    self.inputPipe=[NSPipe pipe];self.outputPipe=[NSPipe pipe];self.errorPipe=[NSPipe pipe];child.standardInput=self.inputPipe;child.standardOutput=self.outputPipe;child.standardError=self.errorPipe;self.process=child;self.outputBuffer=[NSMutableData data];self.serviceURL=nil;self.serviceToken=@"";
    __weak typeof(self) weakSelf=self;
    self.outputPipe.fileHandleForReading.readabilityHandler=^(NSFileHandle *handle){ NSData *data=handle.availableData;if(!data.length)return;dispatch_async(dispatch_get_main_queue(),^{[weakSelf receive:data];});};
    self.errorPipe.fileHandleForReading.readabilityHandler=^(NSFileHandle *handle){ (void)handle.availableData; };
    child.terminationHandler=^(NSTask *task){dispatch_async(dispatch_get_main_queue(),^{[weakSelf engineExited:task.terminationStatus];});};
    if(![child launchAndReturnError:&error]) { self.outputPipe.fileHandleForReading.readabilityHandler=nil;self.errorPipe.fileHandleForReading.readabilityHandler=nil;self.process=nil;[self showLoading:@"捕获服务未启动" detail:error.localizedDescription];return; }
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW,18*NSEC_PER_SEC),dispatch_get_main_queue(),^{if(!weakSelf.serviceURL&&weakSelf.process.running)[weakSelf showLoading:@"启动时间较长" detail:@"可以从菜单栏选择“重新启动捕获服务”。若持续失败，请检查应用是否完整解压。"];} );
}
- (void)receive:(NSData *)data {
    [self.outputBuffer appendData:data];NSData *newline=[@"\n" dataUsingEncoding:NSUTF8StringEncoding];
    while(YES){NSRange r=[self.outputBuffer rangeOfData:newline options:0 range:NSMakeRange(0,self.outputBuffer.length)];if(r.location==NSNotFound)break;NSData *line=[self.outputBuffer subdataWithRange:NSMakeRange(0,r.location)];[self.outputBuffer replaceBytesInRange:NSMakeRange(0,r.location+1) withBytes:NULL length:0];NSString *text=[[NSString alloc] initWithData:line encoding:NSUTF8StringEncoding];if(![text hasPrefix:@"H2F_EVENT "])continue;NSDictionary *event=[NSJSONSerialization JSONObjectWithData:[[text substringFromIndex:10] dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];if(![event isKindOfClass:NSDictionary.class])continue;
        NSString *type=event[@"type"];
        if([type isEqualToString:@"ready"]){self.serviceURL=[NSURL URLWithString:event[@"url"]];self.serviceToken=event[@"token"];self.lastReadyAt=[NSDate date];self.statusItem.button.toolTip=@"HTML to Figma · 已就绪";[self showHome:nil];}
        else if([type isEqualToString:@"pair-request"]){[self showPairing:event[@"id"] code:event[@"code"]];}
        else if([type isEqualToString:@"activity"]){self.statusItem.button.toolTip=[event[@"phase"] isEqualToString:@"capturing"]?@"HTML to Figma · 正在捕获":@"HTML to Figma · 已就绪";}
        else if([type isEqualToString:@"error"]){[self showLoading:@"捕获服务未启动" detail:event[@"message"]?:@"请重新启动助手。"];}
    }
}
- (void)showPairing:(NSString *)requestID code:(NSString *)code {
    [self.pendingPairIDs addObject:requestID];[self showHome:nil];
}

- (void)send:(NSDictionary *)message {
    if(!self.process.running)return;NSData *data=[NSJSONSerialization dataWithJSONObject:message options:0 error:nil];if(!data)return;NSMutableData *line=[data mutableCopy];[line appendData:[@"\n" dataUsingEncoding:NSUTF8StringEncoding]];[self.inputPipe.fileHandleForWriting writeData:line error:nil];
}
- (void)engineExited:(int)code {
    self.outputPipe.fileHandleForReading.readabilityHandler=nil;self.errorPipe.fileHandleForReading.readabilityHandler=nil;self.process=nil;self.serviceURL=nil;self.serviceToken=@"";[self.pendingPairIDs removeAllObjects];
    if(self.quitting){[NSApp replyToApplicationShouldTerminate:YES];return;}if(self.restarting){self.restarting=NO;[self startEngine];return;}
    if(self.lastReadyAt&&-[self.lastReadyAt timeIntervalSinceNow]>30)self.crashCount=0;self.lastReadyAt=nil;self.crashCount++;
    if(self.crashCount<=2){[self showLoading:@"正在恢复捕获服务" detail:@"服务意外退出，助手正在重新启动。"];dispatch_after(dispatch_time(DISPATCH_TIME_NOW,NSEC_PER_SEC),dispatch_get_main_queue(),^{[self startEngine];});}
    else [self showLoading:@"捕获服务已停止" detail:[NSString stringWithFormat:@"请从菜单栏选择“重新启动捕获服务”。退出码：%d。",code]];
}
- (void)showWindow:(id)sender {[self.window makeKeyAndOrderFront:nil];[NSApp activateIgnoringOtherApps:YES];}
- (void)showHome:(id)sender {if(self.serviceURL)[self.webView loadRequest:[NSURLRequest requestWithURL:[self.serviceURL URLByAppendingPathComponent:@"desktop"]]];[self showWindow:nil];}
- (void)openWorkbench:(id)sender {if(self.serviceURL)[self.webView loadRequest:[NSURLRequest requestWithURL:self.serviceURL]];[self showWindow:nil];}
- (void)reloadView:(id)sender {[self.webView reload];}
- (void)showPlugin:(id)sender {
    NSFileManager *fm=NSFileManager.defaultManager;NSString *destination=[self.dataDirectory stringByAppendingPathComponent:@"Figma Plugin"],*source=[self.engineRoot stringByAppendingPathComponent:@"figma-plugin"];NSError *error=nil;[fm createDirectoryAtPath:destination withIntermediateDirectories:YES attributes:nil error:&error];NSString *manifest=[destination stringByAppendingPathComponent:@"manifest.json"];NSDictionary *old=[NSJSONSerialization JSONObjectWithData:[NSData dataWithContentsOfFile:manifest]?:[NSData data] options:0 error:nil];NSString *preservedID=old[@"id"];
    for(NSString *name in @[@"manifest.json",@"dist"]){NSString *target=[destination stringByAppendingPathComponent:name];if([fm fileExistsAtPath:target]&&![fm removeItemAtPath:target error:&error])break;if(![fm copyItemAtPath:[source stringByAppendingPathComponent:name] toPath:target error:&error])break;}
    if(!error&&preservedID){NSMutableDictionary *next=[[NSJSONSerialization JSONObjectWithData:[NSData dataWithContentsOfFile:manifest] options:0 error:nil] mutableCopy];next[@"id"]=preservedID;[[NSJSONSerialization dataWithJSONObject:next options:NSJSONWritingPrettyPrinted error:nil] writeToFile:manifest options:NSDataWritingAtomic error:&error];}
    if(error){NSAlert *a=[NSAlert new];a.messageText=@"无法准备 Figma 插件";a.informativeText=error.localizedDescription;[a runModal];return;}[NSWorkspace.sharedWorkspace activateFileViewerSelectingURLs:@[[NSURL fileURLWithPath:manifest]]];
}
- (void)restartEngine:(id)sender {
    self.crashCount=0;if(!self.process.running){[self startEngine];return;}self.restarting=YES;[self showLoading:@"正在重新启动" detail:@"当前捕获会停止，已导入的 Figma 图层不会受影响。"];[self send:@{@"type":@"shutdown"}];pid_t pid=self.process.processIdentifier;dispatch_after(dispatch_time(DISPATCH_TIME_NOW,6*NSEC_PER_SEC),dispatch_get_main_queue(),^{if(self.restarting&&self.process.processIdentifier==pid)[self.process terminate];});
}
- (void)quitApp:(id)sender {[NSApp terminate:nil];}
- (void)showAbout:(id)sender {NSAlert *a=[NSAlert new];a.messageText=@"HTML to Figma 捕获助手";a.informativeText=[NSString stringWithFormat:@"版本 %@ · Apple Silicon 本地测试版\n内置运行环境与捕获浏览器。\n未经过 Apple Developer ID 公证。",[NSBundle.mainBundle objectForInfoDictionaryKey:@"CFBundleShortVersionString"]];[a addButtonWithTitle:@"好"];[a runModal];}
- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender {return NO;}
- (BOOL)applicationShouldHandleReopen:(NSApplication *)sender hasVisibleWindows:(BOOL)flag {[self showWindow:nil];return YES;}
- (NSApplicationTerminateReply)applicationShouldTerminate:(NSApplication *)sender {
    if(!self.process.running)return NSTerminateNow;self.quitting=YES;[self send:@{@"type":@"shutdown"}];pid_t pid=self.process.processIdentifier;dispatch_after(dispatch_time(DISPATCH_TIME_NOW,6*NSEC_PER_SEC),dispatch_get_main_queue(),^{if(self.process.processIdentifier==pid)[self.process terminate];[NSApp replyToApplicationShouldTerminate:YES];});return NSTerminateLater;
}
- (void)userContentController:(WKUserContentController *)controller didReceiveScriptMessage:(WKScriptMessage *)message {
    NSURL *url=message.frameInfo.request.URL;if(!message.frameInfo.mainFrame||![url.host isEqualToString:@"127.0.0.1"]||![url.port isEqual:self.serviceURL.port]||![message.body isKindOfClass:NSDictionary.class])return;NSString *action=message.body[@"action"];
    if([@[@"pair-approve",@"pair-reject"] containsObject:action]){NSString *requestID=message.body[@"id"];if([url.path isEqualToString:@"/desktop"]&&[requestID isKindOfClass:NSString.class]&&[self.pendingPairIDs containsObject:requestID]){[self send:@{@"type":@"pair-decision",@"id":requestID,@"approved":@([action isEqualToString:@"pair-approve"])}];[self.pendingPairIDs removeObject:requestID];}return;}
    if([action isEqualToString:@"open-workbench"])[self openWorkbench:nil];else if([action isEqualToString:@"show-plugin"])[self showPlugin:nil];else if([action isEqualToString:@"restart"])[self restartEngine:nil];else if([action isEqualToString:@"quit"])[self quitApp:nil];else if([action isEqualToString:@"copy-code"]){[NSPasteboard.generalPasteboard clearContents];[NSPasteboard.generalPasteboard setString:self.serviceToken forType:NSPasteboardTypeString];}
}
- (void)webView:(WKWebView *)webView decidePolicyForNavigationAction:(WKNavigationAction *)action decisionHandler:(void (^)(WKNavigationActionPolicy))handler {
    if(action.shouldPerformDownload){handler(WKNavigationActionPolicyDownload);return;}NSURL *url=action.request.URL;if(!url){handler(WKNavigationActionPolicyCancel);return;}
    if([@[@"about",@"blob"] containsObject:url.scheme]||([url.host isEqualToString:@"127.0.0.1"]&&[url.port isEqual:self.serviceURL.port])){handler(WKNavigationActionPolicyAllow);return;}
    if(action.targetFrame&&!action.targetFrame.mainFrame){handler(WKNavigationActionPolicyAllow);return;}
    if([@[@"http",@"https"] containsObject:url.scheme]&&action.navigationType==WKNavigationTypeLinkActivated)[NSWorkspace.sharedWorkspace openURL:url];handler(WKNavigationActionPolicyCancel);
}
- (void)webView:(WKWebView *)webView runOpenPanelWithParameters:(WKOpenPanelParameters *)parameters initiatedByFrame:(WKFrameInfo *)frame completionHandler:(void (^)(NSArray<NSURL *> *))handler {
    NSOpenPanel *panel=[NSOpenPanel openPanel];panel.allowsMultipleSelection=parameters.allowsMultipleSelection;panel.canChooseDirectories=parameters.allowsDirectories;panel.canChooseFiles=YES;[panel beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse response){handler(response==NSModalResponseOK?panel.URLs:nil);}];
}
- (void)webView:(WKWebView *)webView navigationAction:(WKNavigationAction *)action didBecomeDownload:(WKDownload *)download {download.delegate=self;}
- (void)webView:(WKWebView *)webView navigationResponse:(WKNavigationResponse *)response didBecomeDownload:(WKDownload *)download {download.delegate=self;}
- (void)download:(WKDownload *)download decideDestinationUsingResponse:(NSURLResponse *)response suggestedFilename:(NSString *)name completionHandler:(void (^)(NSURL *))handler {
    NSSavePanel *panel=[NSSavePanel savePanel];panel.nameFieldStringValue=name;panel.directoryURL=[NSURL fileURLWithPath:NSSearchPathForDirectoriesInDomains(NSDownloadsDirectory,NSUserDomainMask,YES).firstObject];[panel beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse result){handler(result==NSModalResponseOK?panel.URL:nil);}];
}
@end
int main(int argc, const char *argv[]) { @autoreleasepool { NSApplication *app=NSApplication.sharedApplication;H2FAppDelegate *delegate=[H2FAppDelegate new];app.delegate=delegate;[app run]; } return 0; }

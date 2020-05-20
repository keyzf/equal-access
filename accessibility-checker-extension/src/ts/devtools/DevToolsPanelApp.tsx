/******************************************************************************
     Copyright:: 2020- IBM, Inc

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.
  *****************************************************************************/
 
import React from "react";
import Header from "./Header";
import Help from "./Help";
import ReportSummary from "./ReportSummary";
import ReportSplash from "./ReportSplash";
import Report, { preprocessReport, IReport, IReportItem, ICheckpoint, IRuleset } from "./Report";
import PanelMessaging from '../util/panelMessaging';
import {
    Loading
} from 'carbon-components-react';


// File is generated by report-react build
import { genReport } from './genReport';
import HelpHeader from './HelpHeader';

interface IPanelProps {
    layout: "main" | "sub"
}

interface IPanelState {
    listenerRegistered: boolean,
    numScanning: number,
    report: IReport | null,
    filter: string | null,
    tabURL: string,
    tabId: number,
    selectedItem?: IReportItem,
    rulesets: IRuleset[] | null,
    selectedCheckpoint? : ICheckpoint,
    learnMore : boolean,
    learnItem : IReportItem | null
}

export default class DevToolsPanelApp extends React.Component<IPanelProps, IPanelState> {
    state: IPanelState = {
        listenerRegistered: false,
        numScanning: 0,
        report: null,
        filter: null,
        tabURL: "",
        tabId: -1,
        rulesets: null,
        learnMore: false,
        learnItem: null
    }
    
    ignoreNext = false;

    constructor(props: any) {
        super(props);
        // Only listen to element events on the subpanel
        if (this.props.layout=== "sub") {
            chrome.devtools.panels.elements.onSelectionChanged.addListener(() => {
                chrome.devtools.inspectedWindow.eval(`((node) => {
                    let countNode = (node) => { 
                        let count = 0;
                        let findName = node.nodeName;
                        while (node) { 
                            if (node.nodeName === findName) {
                                ++count;
                            }
                            node = node.previousElementSibling; 
                        }
                        return "/"+findName.toLowerCase()+"["+count+"]";
                    }
                    let retVal = "";
                    while (node && node.nodeType === 1) {
                        if (node) {
                            retVal = countNode(node)+retVal;
                            if (node.parentElement) {
                                node = node.parentElement;
                            } else {
                                let parentElement = null;
                                try {
                                    // Check if we're in an iframe
                                    let parentWin = node.ownerDocument.defaultView.parent;
                                    let iframes = parentWin.document.documentElement.querySelectorAll("iframe");
                                    for (const iframe of iframes) {
                                        try {
                                            if (iframe.contentDocument === node.ownerDocument) {
                                                parentElement = iframe;
                                                break;
                                            }
                                        } catch (e) {}
                                    }
                                } catch (e) {}
                                node = parentElement;
                            }
                        }
                    }
                    return retVal;
                })($0)`, (result: string) => {
                    this.onFilter(result);
                    // This filter occurred because we selected something on the right
                    if (this.ignoreNext) {
                        this.ignoreNext = false;
                    }
                });
            });
        }
    }

    async componentDidMount() {
        var self = this;

        let tabs = await PanelMessaging.sendToBackground("TAB_INFO", { })
        if (tabs[0] && tabs[0].url && tabs[0].id) {
            let rulesets = await PanelMessaging.sendToBackground("DAP_Rulesets", { tabId: tabs[0].id })
            var url = tabs[0].url;
            if (!self.state.listenerRegistered) {
                PanelMessaging.addListener("TAB_UPDATED", async message => {
                    if (message.tabId === self.state.tabId && message.status === "loading") {
                        if (message.tabUrl && message.tabUrl != self.state.tabURL) {
                            self.setState({ report: null, tabURL: message.tabUrl });
                        }
                    }
                });
                PanelMessaging.addListener("DAP_SCAN_COMPLETE", self.onReport.bind(self));
                PanelMessaging.sendToBackground("DAP_CACHED", { tabId: tabs[0].id })
            }
            self.setState({ rulesets: rulesets, listenerRegistered: true, tabURL: url, tabId: tabs[0].id });
        }
    }

    async startScan() {
        let tabId = this.state.tabId;
        if (tabId === -1) {
            // componentDidMount is not done initializing yet
            setTimeout(this.startScan.bind(this), 100);
        } else {
            this.setState({ numScanning: this.state.numScanning + 1 });
            await PanelMessaging.sendToBackground("DAP_SCAN", { tabId: tabId })
        }
    }

    collapseAll() {
        if (this.state.report) {
            this.state.report.filterstamp = new Date().getTime();
            this.setState({ filter: null, report: preprocessReport(this.state.report, null, false), selectedItem: undefined, selectedCheckpoint: undefined });
        }
    }

    async onReport(message: any): Promise<any> {
        let report = message.report;
        // JCH add itemIdx to report (used to be in message.report)
        report.results.map((result:any, index:any) => {
            result["itemIdx"] = index;
        })
        let tabId = message.tabId;
        if (!report) return;

        if (this.state.tabId === tabId) {
            report.timestamp = new Date().getTime();
            report.filterstamp = new Date().getTime();
            this.setState({ 
                filter: null, 
                numScanning: Math.max(0, this.state.numScanning - 1), 
                report: preprocessReport(report, null, false), 
                selectedItem: undefined
            });
        }
        return true;
    }

    onFilter(filter: string) {
        if (this.state.report) {
            this.state.report.filterstamp = new Date().getTime();
            this.setState({ filter: filter, report: preprocessReport(this.state.report, filter, !this.ignoreNext) });
        }
    }

    reportHandler = async ()=>{
        if (this.state.report && this.state.rulesets) {
            var reportObj : any = {
                tabURL: this.state.tabURL,
                rulesets: this.state.rulesets,
                report: {
                    timestamp: this.state.report.timestamp,
                    nls: this.state.report.nls,
                    counts: {
                        "total": this.state.report.counts.total,
                        "filtered": this.state.report.counts.filtered
                    },
                    results: []
                }
            }
            for (const result of this.state.report.results) {
                reportObj.report.results.push({
                    ruleId: result.ruleId,
                    path: result.path,
                    value: result.value,
                    message: result.message,
                    snippet: result.snippet
                });
            }
            var filename = "report.html";
            var fileContent = "data:text/html;charset=utf-8," + encodeURIComponent(genReport(reportObj));
            var a = document.createElement('a');
            a.href = fileContent;
            a.download = filename;
            var e = document.createEvent('MouseEvents');
            e.initMouseEvent('click', true, false, window, 0, 0, 0, 0, 0, false, false, false, false, 0, null);
            a.dispatchEvent(e);
        }
    }

    selectItem(item?: IReportItem, checkpoint?: ICheckpoint) {
        if (this.state.report) {
            if (!item) {
                for (const resultItem of this.state.report.results) {
                    resultItem.selected = false;
                }
                this.setState({selectedItem: undefined, report: this.state.report});
            } else {
                if (this.props.layout === "main") {
                    if (this.state.rulesets && !checkpoint) {
                        for (const rs of this.state.rulesets) {
                            if (rs.id === "IBM_Accessibility") {
                                for (const cp of rs.checkpoints) {
                                    for (const rule of cp.rules) {
                                        if (rule.id === item.ruleId) {
                                            checkpoint = cp;
                                        }
                                    }
                                }
                            }
                        }
                    }

                    for (const resultItem of this.state.report.results) {
                        resultItem.selected = resultItem.itemIdx === item.itemIdx;
                    }
                    this.setState({selectedItem: item, report: this.state.report, selectedCheckpoint: checkpoint});
                } else if (this.props.layout === "sub") {
                    if (this.state.report) {
                        for (const resultItem of this.state.report.results) {
                            resultItem.selected = resultItem.path.dom === item.path.dom;
                        }
                        this.setState({report: this.state.report});
                    }

                    var script =
`function lookup(doc, xpath) {
    let nodes = doc.evaluate(xpath, doc, null, XPathResult.ANY_TYPE, null);
    let element = nodes.iterateNext();
    if (element) {
        return element;
    } else {
        return null;
    }
}
function selectPath(srcPath) {
    let doc = document;
    let element = null;
    while (srcPath && srcPath.includes("iframe")) {
        let parts = srcPath.match(/(.*?iframe\\[\\d+\\])(.*)/);
        let iframe = lookup(doc, parts[1]);
        element = iframe || element;
        if (iframe && iframe.contentDocument && iframe.contentDocument) {
            doc = iframe.contentDocument;
            srcPath = parts[2];
        } else {
            srcPath = null;
        }
    }
    if (srcPath) {
        element = lookup(doc, srcPath) || element;
    }
    if (element) {
        inspect(element);
        var elementRect = element.getBoundingClientRect();
        var absoluteElementTop = elementRect.top + window.pageYOffset;
        var middle = absoluteElementTop - 100;
        element.ownerDocument.defaultView.scrollTo({
            top: middle,
            behavior: 'smooth'
        });
        return true;
    }
    return;
}
selectPath("${item.path.dom}");
`
                    this.ignoreNext = true;
                    chrome.devtools.inspectedWindow.eval(script, function (result, isException) {
                        if (isException) {
                            console.error(isException);
                        }
                        if (!result) {
                            console.log('Could not select element, it may have moved');
                        }
                    });

                    this.onFilter(item.path.dom)
                }
            }
        }
    }

    getItem(item: IReportItem) {
        this.setState({learnMore: true, learnItem: item});
    }

    learnHelp() {
        this.setState({learnMore: false});
    }

    render() {
        if (this.props.layout === "main") {
            return <React.Fragment>
                <div style={{display: "flex", height: "100%", maxWidth: "50%"}} className="mainPanel">
                    <div style={{flex: "1 1 50%", backgroundColor: "#f4f4f4", overflowY: this.state.report && this.state.selectedItem ? "scroll": undefined}}>
                        {!this.state.report && <ReportSplash /> }
                        {this.state.report && !this.state.selectedItem && <ReportSummary tabURL={this.state.tabURL} report={this.state.report} />}
                        {this.state.report && this.state.selectedItem && <Help report={this.state.report!} item={this.state.selectedItem} checkpoint={this.state.selectedCheckpoint} /> }
                    </div>
                    <div style={{flex: "1 1 50%"}} className="mainPanelRight">
                        <Header 
                            layout={this.props.layout} 
                            counts={this.state.report && this.state.report.counts} 
                            startScan={this.startScan.bind(this)} 
                            reportHandler={this.reportHandler.bind(this)}
                            collapseAll={this.collapseAll.bind(this)}
                            />
                        <div style={{marginTop: "7rem", height: "calc(100% - 7rem)"}}>
                            <main>
                                {this.state.numScanning > 0 ? <Loading /> : <></>}
                                {this.state.report && <Report 
                                    selectItem={this.selectItem.bind(this)} 
                                    rulesets={this.state.rulesets} 
                                    report={this.state.report} 
                                    getItem = {this.getItem.bind(this)} 
                                    layout = {this.props.layout}
                                    selectedTab="checklist"
                                    tabs={["checklist", "element", "rule"]} />}
                                    
                            </main>
                        </div>
                    </div>
                </div>
            </React.Fragment>
        } else if (this.props.layout === "sub") {
            if (this.state.learnMore) {
                return <React.Fragment>
                    <HelpHeader learnHelp={this.learnHelp.bind(this)}  layout={this.props.layout}></HelpHeader>
                    <div style={{marginTop: "6rem", height: "calc(100% - 6rem)"}}>
                        <main>
                            <div className="subPanel">
                                {this.state.report && this.state.learnItem && <Help report={this.state.report!} item={this.state.learnItem} checkpoint={this.state.selectedCheckpoint} /> }
                            </div>
                        </main>
                    </div>                
                </React.Fragment>
            } else {
            return <React.Fragment>
                <Header 
                    layout={this.props.layout} 
                    counts={this.state.report && this.state.report.counts} 
                    startScan={this.startScan.bind(this)} 
                    reportHandler={this.reportHandler.bind(this)}
                    collapseAll={this.collapseAll.bind(this)}
                    />
                <div style={{marginTop: "9rem", height: "calc(100% - 9rem)"}}>
                    <main>
                        {this.state.numScanning > 0 ? <Loading /> : <></>}
                        {this.state.report && <Report 
                            selectItem={this.selectItem.bind(this)} 
                            rulesets={this.state.rulesets} 
                            report={this.state.report} 
                            getItem = {this.getItem.bind(this)} 
                            layout = {this.props.layout}
                            selectedTab="element"
                            tabs={["checklist", "element", "rule"]} />}
                    </main>
                </div>
            </React.Fragment>
            }
        } else {
            return <React.Fragment>ERROR</React.Fragment>
        }
    }
}
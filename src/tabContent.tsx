import "./tabContent.scss"

import * as SDK from "azure-devops-extension-sdk"
import * as React from "react"
import * as ReactDOM from "react-dom"
import { getClient } from "azure-devops-extension-api"
import { Attachment, Build, BuildRestClient } from "azure-devops-extension-api/Build"


const ATTACHMENT_TYPE = "allure-report";

SDK.init()
SDK.ready().then(() => {
  try {
    const config = SDK.getConfiguration()
    config.onBuildChanged((build: Build) => {
      new BuildAttachmentClient(build).init().then((buildAttachmentClient) => {
        displayReport(buildAttachmentClient.reportHtmlContent)
      }).catch(error => { throw new Error(error) })
    })
  } catch (error) {
    throw new Error(error)
  }
})

function displayReport(reportHtml: string) {
  ReactDOM.render(<AllureIFrameComponent reportHtml={reportHtml} />, document.getElementById("allure-report-extension-container"))
}


class BuildAttachmentClient {
  private attachments: Attachment[] = []
  private authHeaders: Object = undefined
  public reportHtmlContent: string = undefined
  private build: Build

  constructor(build: Build) {
    this.build = build
  }

  public async init() {
    const buildClient: BuildRestClient = getClient(BuildRestClient)
    this.attachments = await buildClient.getAttachments(this.build.project.id, this.build.id, ATTACHMENT_TYPE)
    this.reportHtmlContent = await this.getAttachmentContent(this.attachments[0])
    return this;
  }

  public async getAttachmentContent(attachment: Attachment): Promise<string> {
    if (!(attachment && attachment._links && attachment._links.self && attachment._links.self.href)) {
      throw new Error("Attachment " + attachment?.name + " is not downloadable")
    }
    if (this.authHeaders === undefined) {
      const accessToken = await SDK.getAccessToken()
      const b64encodedAuth = Buffer.from(':' + accessToken).toString('base64')
      this.authHeaders = { headers: { 'Authorization': 'Basic ' + b64encodedAuth } }
    }
    const response = await fetch(attachment._links.self.href, this.authHeaders)
    if (!response.ok) {
      throw new Error(response.statusText)
    }
    return await response.text()
  }

}


interface AllureIFrameComponentProps {
  reportHtml: string
}

export default class AllureIFrameComponent extends React.Component<AllureIFrameComponentProps> {

  constructor(props: AllureIFrameComponentProps) {
    super(props);
    this.writeContentDocument = this.writeContentDocument.bind(this)
  }

  public writeContentDocument(iFrame: HTMLIFrameElement) {
    if (!iFrame) {
      return
    }
    const contentDocument = iFrame.contentDocument
    contentDocument.open()
    contentDocument.write(this.props.reportHtml)
    contentDocument.close()
  }

  public render() {
    return <div className="flex-column">
         <iframe className="wide flex-row flex-center" ref={this.writeContentDocument}></iframe>
    </div>
  }


}




# azure-pipeline-allure-report

Azure DevOps extension that provides a task for publishing an allure report by inlining all related files and embedding it into a Build and Release page as separate tab.

### Extension

In order to see report on tab one must first use `Publish Allure Report` task. This is supporting task which reads and inlines the provided allure report. Finally the inlined allure report is added as attachment of type `allure-report`

This task takes one parameter - required `reportDir` which is a path to report directory containing the `index.html` file of the allure report and corresponding files. The optional `tabName` parameter is the name of the tab displayed within Build and Release page. 

#### Example YAML setup

```YAML
steps:
  - task: PublishAllureReport@1
    displayName: 'Publish Allure Report'
    inputs:
      reportDir: '$(AllureReportDirectory)'
```
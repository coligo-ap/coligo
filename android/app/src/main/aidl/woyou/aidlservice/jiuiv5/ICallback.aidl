// Callback Sunmi pour le service d'impression `woyou.aidlservice.jiuiv5`.
// Déclaration officielle Sunmi — à conserver telle quelle, le package
// `woyou.aidlservice.jiuiv5` est imposé par le service système Sunmi.
package woyou.aidlservice.jiuiv5;

interface ICallback {
    void onRunResult(boolean isSuccess);
    void onReturnString(String result);
    void onRaiseException(int code, String msg);
    void onPrintResult(int code, String msg);
}

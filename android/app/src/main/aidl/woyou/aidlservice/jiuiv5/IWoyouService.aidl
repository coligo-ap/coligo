// Service d'impression Sunmi (V1/V2/T2/V3). Le package est imposé par le
// système Sunmi (`woyou.aidlservice.jiuiv5`) — on déclare une copie de
// l'interface officielle pour binder le service AIDL exposé par le firmware
// Sunmi sans dépendre d'un AAR externe.
package woyou.aidlservice.jiuiv5;

import woyou.aidlservice.jiuiv5.ICallback;
import android.graphics.Bitmap;

interface IWoyouService {
    void printerInit(in ICallback callback);
    void printerSelfChecking(in ICallback callback);
    String getPrinterSerialNo();
    String getPrinterModal();
    String getPrinterVersion();

    int updatePrinter(int printerStatus);
    int getPrinterPaper();
    int getPrinterMode();
    int getPrintedLength();

    void sendRAWData(in byte[] data, in ICallback callback);
    void setAlignment(int alignment, in ICallback callback);
    void setFontName(String typeface, in ICallback callback);
    void setFontSize(float fontsize, in ICallback callback);

    void printText(String text, in ICallback callback);
    void printTextWithFont(String text, String typeface, float fontsize, in ICallback callback);
    void printOriginalText(String text, in ICallback callback);
    void printColumnsText(in String[] colsTextArr, in int[] colsWidthArr, in int[] colsAlign, in ICallback callback);

    void printBitmap(in Bitmap bitmap, in ICallback callback);
    void printBarCode(String data, int symbology, int height, int width, int textposition, in ICallback callback);
    void printQRCode(String data, int modulesize, int errorlevel, in ICallback callback);

    void lineWrap(int n, in ICallback callback);
    void cutPaper(in ICallback callback);
    int getCutPaperTimes();

    void enterPrinterBuffer(boolean clean);
    void exitPrinterBuffer(boolean commit);
    void commitPrinterBuffer();
    void clearBuffer();
    void commitPrinterBufferWithCallback(in ICallback callback);
    void exitPrinterBufferWithCallback(boolean commit, in ICallback callback);
}

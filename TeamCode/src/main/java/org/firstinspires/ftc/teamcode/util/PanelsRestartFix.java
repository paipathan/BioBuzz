package org.firstinspires.ftc.teamcode.util;

import android.content.Context;

import com.bylazar.panels.Panels;
import com.bylazar.panels.server.Socket;
import com.bylazar.panels.server.StaticServer;
import com.qualcomm.ftccommon.FtcEventLoop;

import org.firstinspires.ftc.ftccommon.external.OnCreateEventLoop;

/**
 * Works around a Panels bug that freezes it after "Restart Robot".
 *
 * Every restart re-runs Panels' init, which builds new servers on ports 8001/8002 without stopping
 * the old ones. The new ones fail to bind ("Address already in use"), the old ones keep serving the
 * page, and live telemetry/field updates go to the new, client-less socket: Panels says "Connected"
 * but never updates. Stopping the still-running old servers here frees the ports first. Panels'
 * init runs on its own thread and spends seconds scanning classes before it creates the new
 * servers, so this always runs before them; anything not alive (first launch) is left alone.
 */
public final class PanelsRestartFix {
    private PanelsRestartFix() {}

    @OnCreateEventLoop
    public static void stopOldPanelsServers(Context context, FtcEventLoop eventLoop) {
        StaticServer server = Panels.INSTANCE.getServer();
        Socket socket = Panels.INSTANCE.getSocket();
        if (server != null && server.isAlive()) server.stopServer();
        if (socket != null && socket.isAlive()) socket.stopServer();
    }
}

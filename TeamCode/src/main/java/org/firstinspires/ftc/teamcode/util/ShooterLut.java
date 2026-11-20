package org.firstinspires.ftc.teamcode.util;

import org.firstinspires.ftc.robotcore.internal.system.AppUtil;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.io.FileWriter;
import java.io.IOException;
import java.io.PrintWriter;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TreeMap;

/**
 * Shooter LUT entries saved on the robot, so tuned numbers survive restarts.
 * Pull them off with: adb pull /sdcard/FIRST/shooter_lut.csv
 */
public final class ShooterLut {
    public static final File FILE = new File(AppUtil.FIRST_FOLDER, "shooter_lut.csv");
    private static final String HEADER = "slot,pose_x,pose_y,distance_in,rpm";

    private ShooterLut() {}

    public static final class Entry {
        /** Index into Constants.LutTuner.samplePoses. */
        public final int slot;
        /** The sample spot, in red (drawn) coordinates. */
        public final double poseX, poseY;
        /** Goal distance the robot actually measured when the entry was saved. */
        public final double distance;
        public final double rpm;

        public Entry(int slot, double poseX, double poseY, double distance, double rpm) {
            this.slot = slot;
            this.poseX = poseX;
            this.poseY = poseY;
            this.distance = distance;
            this.rpm = rpm;
        }
    }

    /** Saved entries keyed by slot. Empty if nothing has been saved yet. */
    public static Map<Integer, Entry> load() {
        Map<Integer, Entry> entries = new TreeMap<>();
        if (!FILE.exists()) return entries;
        try (BufferedReader reader = new BufferedReader(new FileReader(FILE))) {
            String line;
            while ((line = reader.readLine()) != null) {
                line = line.trim();
                if (line.isEmpty() || line.startsWith("slot")) continue;
                String[] parts = line.split(",");
                if (parts.length < 5) continue;
                try {
                    Entry entry = new Entry(
                            Integer.parseInt(parts[0].trim()),
                            Double.parseDouble(parts[1].trim()),
                            Double.parseDouble(parts[2].trim()),
                            Double.parseDouble(parts[3].trim()),
                            Double.parseDouble(parts[4].trim()));
                    entries.put(entry.slot, entry);
                } catch (NumberFormatException ignored) {
                    // skip a bad line rather than lose the rest
                }
            }
        } catch (IOException ignored) {
            // unreadable file: start empty, the next save rewrites it
        }
        return entries;
    }

    /** Rewrites the whole file, sorted by distance. Writes a temp file first so a crash can't truncate it. */
    public static void save(Collection<Entry> entries) throws IOException {
        List<Entry> sorted = sortedByDistance(entries);
        File dir = FILE.getParentFile();
        if (dir != null && !dir.exists() && !dir.mkdirs()) throw new IOException("can't create " + dir);

        File tmp = new File(FILE.getPath() + ".tmp");
        try (PrintWriter out = new PrintWriter(new FileWriter(tmp))) {
            out.println(HEADER);
            for (Entry e : sorted) {
                out.println(String.format(Locale.US, "%d,%.1f,%.1f,%.2f,%.0f", e.slot, e.poseX, e.poseY, e.distance, e.rpm));
            }
            if (out.checkError()) throw new IOException("write failed");
        }
        if (FILE.exists() && !FILE.delete()) throw new IOException("can't replace " + FILE);
        if (!tmp.renameTo(FILE)) throw new IOException("can't rename " + tmp);
    }

    public static List<Entry> sortedByDistance(Collection<Entry> entries) {
        List<Entry> sorted = new ArrayList<>(entries);
        Collections.sort(sorted, (a, b) -> Double.compare(a.distance, b.distance));
        return sorted;
    }
}
